// echo-taskbar-thumbnail-helper
//
// In-process N-API addon that makes the Electron main window present the
// current album cover as its DWM iconic thumbnail while keeping the live
// preview pointed at the real Electron window.
//
// Exposed to JS:
//   attach(hwndBuffer)            -> bool   subclass the window, enable iconic
//   setCover(rgbaBuffer, w, h)    -> bool   store cover, force iconic + refresh
//   refresh()                     -> bool   request a fresh cover thumbnail
//   clear()                       -> bool   restore live window preview
//   detach()                      -> void   remove subclass (call on close)
//
// All calls must run on the thread that owns the window message loop (the
// Electron main-process main thread), which is where N-API callbacks fire.

#include <napi.h>

#include <windows.h>
#include <commctrl.h>
#include <dwmapi.h>

#include <cstdint>
#include <cmath>
#include <vector>

namespace {

struct HelperState {
  HWND hwnd = nullptr;
  bool subclassed = false;
  bool forced = false;          // DWMWA_FORCE_ICONIC_REPRESENTATION currently on
  std::vector<uint8_t> master;  // 32bpp BGRA, top-down, opaque (alpha = 255)
  int masterWidth = 0;
  int masterHeight = 0;
  // Diagnostics (surfaced via getState) to debug why a surface may not render.
  unsigned int thumbnailRequests = 0;
  unsigned int livePreviewRequests = 0;
  long lastThumbnailHr = 0;    // HRESULT from DwmSetIconicThumbnail
  long lastLivePreviewHr = 0;  // HRESULT from DwmSetIconicLivePreviewBitmap
  bool lastLivePreviewCaptured = false;  // did PrintWindow succeed last time
};

HelperState g_state;
constexpr UINT_PTR kSubclassId = 1;

void SetIconicEnabled(HWND hwnd, bool enabled);
void DisableForcedIconic(HWND hwnd);
bool CaptureWindowPreviewBitmap(HWND hwnd, HBITMAP* bitmapOut);

// Create a 32bpp top-down DIB section; returns the bitmap and its pixel bits.
HBITMAP CreateBgraDib(int width, int height, void** bitsOut) {
  BITMAPINFO info = {};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;  // negative => top-down rows
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* bits = nullptr;
  HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  if (bitsOut) {
    *bitsOut = bits;
  }
  return bitmap;
}

// Build an HBITMAP from the stored master cover, scaled to fit within
// (maxWidth x maxHeight) while preserving aspect ratio. Caller owns the
// returned bitmap and must DeleteObject it. Returns nullptr on failure.
HBITMAP RenderScaledBitmap(const std::vector<uint8_t>& source, int sourceWidth, int sourceHeight,
                           int maxWidth, int maxHeight) {
  if (source.empty() || sourceWidth <= 0 || sourceHeight <= 0) {
    return nullptr;
  }

  maxWidth = (std::max)(1, maxWidth);
  maxHeight = (std::max)(1, maxHeight);

  const double scale = (std::min)(
      static_cast<double>(maxWidth) / sourceWidth,
      static_cast<double>(maxHeight) / sourceHeight);
  int targetWidth = (std::max)(1, static_cast<int>(std::lround(sourceWidth * scale)));
  int targetHeight = (std::max)(1, static_cast<int>(std::lround(sourceHeight * scale)));

  // Source DIB backed by the stored pixels.
  void* srcBits = nullptr;
  HBITMAP srcBitmap = CreateBgraDib(sourceWidth, sourceHeight, &srcBits);
  if (!srcBitmap || !srcBits) {
    if (srcBitmap) DeleteObject(srcBitmap);
    return nullptr;
  }
  memcpy(srcBits, source.data(), source.size());

  // Destination DIB at the fitted size.
  void* dstBits = nullptr;
  HBITMAP dstBitmap = CreateBgraDib(targetWidth, targetHeight, &dstBits);
  if (!dstBitmap || !dstBits) {
    DeleteObject(srcBitmap);
    if (dstBitmap) DeleteObject(dstBitmap);
    return nullptr;
  }

  HDC screenDc = GetDC(nullptr);
  HDC srcDc = CreateCompatibleDC(screenDc);
  HDC dstDc = CreateCompatibleDC(screenDc);
  HGDIOBJ oldSrc = SelectObject(srcDc, srcBitmap);
  HGDIOBJ oldDst = SelectObject(dstDc, dstBitmap);

  SetStretchBltMode(dstDc, HALFTONE);
  SetBrushOrgEx(dstDc, 0, 0, nullptr);
  StretchBlt(dstDc, 0, 0, targetWidth, targetHeight,
             srcDc, 0, 0, sourceWidth, sourceHeight, SRCCOPY);
  GdiFlush();

  // Force full opacity: DWM expects premultiplied ARGB; opaque == straight.
  auto* pixels = static_cast<uint8_t*>(dstBits);
  const size_t pixelCount = static_cast<size_t>(targetWidth) * targetHeight;
  for (size_t i = 0; i < pixelCount; ++i) {
    pixels[i * 4 + 3] = 0xFF;
  }

  SelectObject(srcDc, oldSrc);
  SelectObject(dstDc, oldDst);
  DeleteDC(srcDc);
  DeleteDC(dstDc);
  ReleaseDC(nullptr, screenDc);
  DeleteObject(srcBitmap);

  return dstBitmap;
}

bool CaptureWindowPreviewBitmap(HWND hwnd, HBITMAP* bitmapOut) {
  if (!bitmapOut || !IsWindow(hwnd)) {
    return false;
  }

  RECT client = {};
  if (!GetClientRect(hwnd, &client)) {
    return false;
  }

  const int width = std::max(1, static_cast<int>(client.right - client.left));
  const int height = std::max(1, static_cast<int>(client.bottom - client.top));
  void* bits = nullptr;
  HBITMAP bitmap = CreateBgraDib(width, height, &bits);
  if (!bitmap || !bits) {
    if (bitmap) DeleteObject(bitmap);
    return false;
  }

  HDC screenDc = GetDC(nullptr);
  HDC memDc = CreateCompatibleDC(screenDc);
  HGDIOBJ old = SelectObject(memDc, bitmap);

  BOOL captured = FALSE;
#ifndef PW_RENDERFULLCONTENT
#define PW_RENDERFULLCONTENT 0x00000002
#endif
  captured = PrintWindow(hwnd, memDc, PW_RENDERFULLCONTENT);

  SelectObject(memDc, old);
  DeleteDC(memDc);
  ReleaseDC(nullptr, screenDc);

  if (!captured) {
    DeleteObject(bitmap);
    return false;
  }

  *bitmapOut = bitmap;
  return true;
}

// Window subclass procedure. DWM sends these messages when it needs a fresh
// iconic thumbnail (i.e. when the taskbar hover thumbnail is about to show).
LRESULT CALLBACK SubclassProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam,
                              UINT_PTR /*subclassId*/, DWORD_PTR /*refData*/) {
  switch (message) {
    case WM_DWMSENDICONICTHUMBNAIL: {
      g_state.thumbnailRequests++;
      const int maxWidth = static_cast<int>(HIWORD(lParam));
      const int maxHeight = static_cast<int>(LOWORD(lParam));
      HBITMAP bitmap = RenderScaledBitmap(
          g_state.master,
          g_state.masterWidth,
          g_state.masterHeight,
          maxWidth,
          maxHeight);
      if (bitmap) {
        g_state.lastThumbnailHr = DwmSetIconicThumbnail(hWnd, bitmap, 0);
        DeleteObject(bitmap);
      } else {
        g_state.lastThumbnailHr = -1;  // no master; mark as "render failed"
      }
      return 0;
    }
    case WM_DWMSENDICONICLIVEPREVIEWBITMAP: {
      g_state.livePreviewRequests++;
      HBITMAP bitmap = nullptr;
      g_state.lastLivePreviewCaptured = CaptureWindowPreviewBitmap(hWnd, &bitmap);
      if (g_state.lastLivePreviewCaptured && bitmap) {
        g_state.lastLivePreviewHr = DwmSetIconicLivePreviewBitmap(hWnd, bitmap, nullptr, 0);
        DeleteObject(bitmap);
      } else {
        g_state.lastLivePreviewHr = -1;
        if (bitmap) {
          DeleteObject(bitmap);
        }
      }
      return 0;
    }
    case WM_NCDESTROY:
      RemoveWindowSubclass(hWnd, SubclassProc, kSubclassId);
      g_state.subclassed = false;
      break;
    default:
      break;
  }
  return DefSubclassProc(hWnd, message, wParam, lParam);
}

void SetIconicEnabled(HWND hwnd, bool enabled) {
  BOOL hasIconicBitmap = enabled ? TRUE : FALSE;
  BOOL forceIconicRepresentation = enabled ? TRUE : FALSE;
  DwmSetWindowAttribute(hwnd, DWMWA_HAS_ICONIC_BITMAP, &hasIconicBitmap, sizeof(hasIconicBitmap));
  DwmSetWindowAttribute(
      hwnd,
      DWMWA_FORCE_ICONIC_REPRESENTATION,
      &forceIconicRepresentation,
      sizeof(forceIconicRepresentation));
  g_state.forced = enabled;
}

void DisableForcedIconic(HWND hwnd) {
  BOOL hasIconicBitmap = TRUE;
  BOOL forceIconicRepresentation = FALSE;
  DwmSetWindowAttribute(hwnd, DWMWA_HAS_ICONIC_BITMAP, &hasIconicBitmap, sizeof(hasIconicBitmap));
  DwmSetWindowAttribute(
      hwnd,
      DWMWA_FORCE_ICONIC_REPRESENTATION,
      &forceIconicRepresentation,
      sizeof(forceIconicRepresentation));
  g_state.forced = false;
}

bool StoreRgbaAsBgra(const Napi::CallbackInfo& info, std::vector<uint8_t>& target,
                     int& targetWidth, int& targetHeight) {
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(info.Env(), "expected (Buffer rgba, number width, number height)")
        .ThrowAsJavaScriptException();
    return false;
  }

  auto rgba = info[0].As<Napi::Buffer<uint8_t>>();
  const int width = info[1].As<Napi::Number>().Int32Value();
  const int height = info[2].As<Napi::Number>().Int32Value();
  const size_t expected = static_cast<size_t>(width) * height * 4;
  if (width <= 0 || height <= 0 || rgba.Length() < expected) {
    return false;
  }

  target.resize(expected);
  const uint8_t* src = rgba.Data();
  uint8_t* dst = target.data();
  const size_t pixelCount = static_cast<size_t>(width) * height;
  for (size_t i = 0; i < pixelCount; ++i) {
    dst[i * 4 + 0] = src[i * 4 + 2];  // B
    dst[i * 4 + 1] = src[i * 4 + 1];  // G
    dst[i * 4 + 2] = src[i * 4 + 0];  // R
    dst[i * 4 + 3] = 0xFF;            // A (opaque)
  }
  targetWidth = width;
  targetHeight = height;
  return true;
}

// attach(hwndBuffer) -> bool
Napi::Value Attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "attach expects a Buffer with the native window handle")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "window handle buffer is too small")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  HWND hwnd = *reinterpret_cast<HWND*>(buffer.Data());
  if (!IsWindow(hwnd)) {
    return Napi::Boolean::New(env, false);
  }

  g_state.hwnd = hwnd;
  if (!g_state.subclassed) {
    g_state.subclassed = SetWindowSubclass(hwnd, SubclassProc, kSubclassId, 0) != FALSE;
  }
  if (g_state.subclassed) {
    SetIconicEnabled(hwnd, !g_state.master.empty());
  }
  return Napi::Boolean::New(env, g_state.subclassed);
}

// setCover(rgbaBuffer, width, height) -> bool
Napi::Value SetCover(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_state.hwnd || !IsWindow(g_state.hwnd)) {
    return Napi::Boolean::New(env, false);
  }
  if (!StoreRgbaAsBgra(info, g_state.master, g_state.masterWidth, g_state.masterHeight)) {
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }
    return Napi::Boolean::New(env, false);
  }

  SetIconicEnabled(g_state.hwnd, true);
  DwmInvalidateIconicBitmaps(g_state.hwnd);
  return Napi::Boolean::New(env, true);
}

// refresh() -> bool
Napi::Value Refresh(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_state.hwnd || !IsWindow(g_state.hwnd) || g_state.master.empty()) {
    return Napi::Boolean::New(env, false);
  }
  SetIconicEnabled(g_state.hwnd, true);
  DwmInvalidateIconicBitmaps(g_state.hwnd);
  return Napi::Boolean::New(env, true);
}

// clear() -> bool  (restore the live window preview)
Napi::Value Clear(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  g_state.master.clear();
  g_state.masterWidth = 0;
  g_state.masterHeight = 0;
  if (g_state.hwnd && IsWindow(g_state.hwnd)) {
    SetIconicEnabled(g_state.hwnd, false);
    DwmInvalidateIconicBitmaps(g_state.hwnd);
    return Napi::Boolean::New(env, true);
  }
  return Napi::Boolean::New(env, false);
}

// detach() -> void  (remove the subclass; call before the window is destroyed)
Napi::Value Detach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_state.hwnd && IsWindow(g_state.hwnd)) {
    SetIconicEnabled(g_state.hwnd, false);
    if (g_state.subclassed) {
      RemoveWindowSubclass(g_state.hwnd, SubclassProc, kSubclassId);
    }
  }
  g_state.subclassed = false;
  g_state.hwnd = nullptr;
  g_state.master.clear();
  g_state.masterWidth = 0;
  g_state.masterHeight = 0;
  return env.Undefined();
}

// getState() -> Object  (diagnostics: how many messages, HRESULTs, etc.)
Napi::Value GetState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("forced", Napi::Boolean::New(env, g_state.forced));
  obj.Set("hasMaster", Napi::Boolean::New(env, !g_state.master.empty()));
  obj.Set("thumbnailRequests", Napi::Number::New(env, g_state.thumbnailRequests));
  obj.Set("livePreviewRequests", Napi::Number::New(env, g_state.livePreviewRequests));
  obj.Set("lastThumbnailHr", Napi::Number::New(env, g_state.lastThumbnailHr));
  obj.Set("lastLivePreviewHr", Napi::Number::New(env, g_state.lastLivePreviewHr));
  obj.Set("lastLivePreviewCaptured", Napi::Boolean::New(env, g_state.lastLivePreviewCaptured));
  return obj;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("setCover", Napi::Function::New(env, SetCover));
  exports.Set("refresh", Napi::Function::New(env, Refresh));
  exports.Set("clear", Napi::Function::New(env, Clear));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("getState", Napi::Function::New(env, GetState));
  return exports;
}

NODE_API_MODULE(echo_taskbar_thumbnail_helper, Init)
