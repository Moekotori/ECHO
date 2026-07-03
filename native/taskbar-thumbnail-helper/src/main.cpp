// echo-taskbar-thumbnail-helper
//
// In-process N-API addon that registers a lightweight taskbar tab/proxy HWND
// for the album-cover thumbnail. The proxy paints the cover into its own
// window surface, while taskbar Peek/Live Preview remains the real window.
//
// Exposed to JS:
//   attach(hwndBuffer)            -> bool   remember the main window
//   setCover(rgbaBuffer, w, h)    -> bool   store cover, register proxy + refresh
//   setButtonHandler(callback)    -> bool   receive proxy thumbnail button clicks
//   setButtons(playing, canLike, liked, visible) -> bool
//   refresh()                     -> bool   request a fresh cover thumbnail
//   clear()                       -> bool   remove the proxy thumbnail
//   detach()                      -> void   unregister proxy (call on close)
//
// All calls must run on the thread that owns the window message loop (the
// Electron main-process main thread), which is where N-API callbacks fire.

#include <napi.h>

#include <windows.h>
#include <commctrl.h>
#include <objbase.h>
#include <shobjidl.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>

namespace {

struct HelperState {
  HWND mainHwnd = nullptr;
  HWND proxyHwnd = nullptr;
  ITaskbarList4* taskbar = nullptr;
  bool comInitialized = false;
  bool proxyClassRegistered = false;
  bool tabRegistered = false;
  bool mainSubclassed = false;
  bool proxyTaskbarButtonCreated = false;
  UINT taskbarButtonCreatedMessage = 0;
  int proxyPlacementMode = 0;
  std::vector<uint8_t> master;  // 32bpp BGRA, top-down, opaque (alpha = 255)
  int masterWidth = 0;
  int masterHeight = 0;
  bool buttonHandlerRegistered = false;
  bool buttonsAdded = false;
  bool buttonsConfigured = false;
  bool buttonsVisible = false;
  bool buttonsPlaying = false;
  bool buttonsCanLike = false;
  bool buttonsLiked = false;
  unsigned int buttonClicks = 0;
  long lastButtonsHr = 0;
  Napi::ThreadSafeFunction buttonHandler;
};

HelperState g_state;
constexpr wchar_t kProxyWindowClass[] = L"ECHO_TaskbarThumbnailProxyWindow";
constexpr int kButtonSize = 16;
constexpr int kButtonPrevious = 1;
constexpr int kButtonPlayPause = 2;
constexpr int kButtonNext = 3;
constexpr int kButtonLike = 4;
constexpr int kProxyPreviewSize = 256;
constexpr int kProxyModeCovered = 0;
constexpr int kProxyModeVisible = 1;
constexpr int kProxyModeOffscreen = 2;
constexpr UINT_PTR kMainSubclassId = 1;

void PaintProxyWindow(HWND hwnd);
int GetProxyPlacementMode();
bool IsMainPreviewEligible();
void PositionProxyWindow();
void SyncProxyIdentity();
void SyncProxyWithMainWindow();
bool EnsureProxyRegistered();
bool EnsureProxyAttached();
bool ApplyProxyButtons();
bool EnsureMainSubclassed();
void UnregisterProxyTab();
void DestroyProxyWindow();
void ReleaseTaskbar();
void ReleaseButtonHandler();

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

  maxWidth = std::max(1, maxWidth);
  maxHeight = std::max(1, maxHeight);

  const double scale = std::min(
      static_cast<double>(maxWidth) / sourceWidth,
      static_cast<double>(maxHeight) / sourceHeight);
  int targetWidth = std::max(1, static_cast<int>(std::lround(sourceWidth * scale)));
  int targetHeight = std::max(1, static_cast<int>(std::lround(sourceHeight * scale)));

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

using IconMask = std::array<const char*, kButtonSize>;

constexpr IconMask kPreviousMask = {
    "0000000000000000",
    "0000000000000000",
    "0011000000100000",
    "0011000001100000",
    "0011000011100000",
    "0011000111100000",
    "0011001111100000",
    "0011011111100000",
    "0011011111100000",
    "0011001111100000",
    "0011000111100000",
    "0011000011100000",
    "0011000001100000",
    "0011000000100000",
    "0000000000000000",
    "0000000000000000",
};

constexpr IconMask kPlayMask = {
    "0000000000000000",
    "0000000000000000",
    "0001100000000000",
    "0001110000000000",
    "0001111000000000",
    "0001111100000000",
    "0001111110000000",
    "0001111111000000",
    "0001111111000000",
    "0001111110000000",
    "0001111100000000",
    "0001111000000000",
    "0001110000000000",
    "0001100000000000",
    "0000000000000000",
    "0000000000000000",
};

constexpr IconMask kPauseMask = {
    "0000000000000000",
    "0000000000000000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0001110001110000",
    "0000000000000000",
    "0000000000000000",
};

constexpr IconMask kNextMask = {
    "0000000000000000",
    "0000000000000000",
    "0000010000001100",
    "0000011000001100",
    "0000011100001100",
    "0000011110001100",
    "0000011111001100",
    "0000011111101100",
    "0000011111101100",
    "0000011111001100",
    "0000011110001100",
    "0000011100001100",
    "0000011000001100",
    "0000010000001100",
    "0000000000000000",
    "0000000000000000",
};

constexpr IconMask kHeartMask = {
    "0000000000000000",
    "0000000000000000",
    "0001100001100000",
    "0011110011110000",
    "0110011110011000",
    "0100001100001000",
    "0100000000001000",
    "0010000000010000",
    "0001000000100000",
    "0000100001000000",
    "0000010010000000",
    "0000001100000000",
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
};

constexpr IconMask kHeartFilledMask = {
    "0000000000000000",
    "0000000000000000",
    "0001100001100000",
    "0011110011110000",
    "0111111111111000",
    "0111111111111000",
    "0111111111111000",
    "0011111111110000",
    "0001111111100000",
    "0000111111000000",
    "0000011110000000",
    "0000001100000000",
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
};

HICON CreateMaskIcon(const IconMask& mask, uint8_t red, uint8_t green, uint8_t blue) {
  void* bits = nullptr;
  HBITMAP colorBitmap = CreateBgraDib(kButtonSize, kButtonSize, &bits);
  if (!colorBitmap || !bits) {
    if (colorBitmap) DeleteObject(colorBitmap);
    return nullptr;
  }

  auto* pixels = static_cast<uint8_t*>(bits);
  for (int y = 0; y < kButtonSize; ++y) {
    for (int x = 0; x < kButtonSize; ++x) {
      const bool enabled = mask[y][x] == '1';
      const int offset = (y * kButtonSize + x) * 4;
      pixels[offset + 0] = blue;
      pixels[offset + 1] = green;
      pixels[offset + 2] = red;
      pixels[offset + 3] = enabled ? 0xFF : 0x00;
    }
  }

  HBITMAP maskBitmap = CreateBitmap(kButtonSize, kButtonSize, 1, 1, nullptr);
  if (!maskBitmap) {
    DeleteObject(colorBitmap);
    return nullptr;
  }

  ICONINFO iconInfo = {};
  iconInfo.fIcon = TRUE;
  iconInfo.hbmColor = colorBitmap;
  iconInfo.hbmMask = maskBitmap;
  HICON icon = CreateIconIndirect(&iconInfo);
  DeleteObject(colorBitmap);
  DeleteObject(maskBitmap);
  return icon;
}

void ReleaseIcons(std::array<HICON, 4>& icons) {
  for (HICON icon : icons) {
    if (icon) {
      DestroyIcon(icon);
    }
  }
}

void CopyTooltip(THUMBBUTTON& button, const wchar_t* text) {
  wcsncpy_s(button.szTip, text, _TRUNCATE);
}

std::array<HICON, 4> CreateButtonIcons(bool playing, bool liked) {
  return {
      CreateMaskIcon(kPreviousMask, 32, 41, 67),
      CreateMaskIcon(playing ? kPauseMask : kPlayMask, 32, 41, 67),
      CreateMaskIcon(kNextMask, 32, 41, 67),
      CreateMaskIcon(liked ? kHeartFilledMask : kHeartMask, liked ? 220 : 32, liked ? 38 : 41, liked ? 72 : 67),
  };
}

bool BuildThumbButtons(std::array<THUMBBUTTON, 4>& buttons, std::array<HICON, 4>& icons) {
  icons = CreateButtonIcons(g_state.buttonsPlaying, g_state.buttonsLiked);
  for (HICON icon : icons) {
    if (!icon) {
      ReleaseIcons(icons);
      return false;
    }
  }

  const THUMBBUTTONFLAGS hiddenFlags =
      static_cast<THUMBBUTTONFLAGS>(THBF_HIDDEN | THBF_DISABLED);
  const THUMBBUTTONFLAGS enabledFlags = THBF_ENABLED;
  const THUMBBUTTONFLAGS disabledFlags = THBF_DISABLED;
  const THUMBBUTTONFLAGS baseFlags = g_state.buttonsVisible ? enabledFlags : hiddenFlags;

  const int ids[4] = {kButtonPrevious, kButtonPlayPause, kButtonNext, kButtonLike};
  const wchar_t* tips[4] = {
      L"Previous",
      g_state.buttonsPlaying ? L"Pause" : L"Play",
      L"Next",
      g_state.buttonsLiked ? L"Unlike" : L"Like",
  };

  for (size_t i = 0; i < buttons.size(); ++i) {
    buttons[i] = {};
    buttons[i].dwMask = static_cast<THUMBBUTTONMASK>(THB_ICON | THB_TOOLTIP | THB_FLAGS);
    buttons[i].iId = ids[i];
    buttons[i].hIcon = icons[i];
    buttons[i].dwFlags = baseFlags;
    CopyTooltip(buttons[i], tips[i]);
  }

  if (g_state.buttonsVisible && !g_state.buttonsCanLike) {
    buttons[3].dwFlags = disabledFlags;
  }
  return true;
}

void DispatchButtonClick(int buttonId) {
  g_state.buttonClicks++;
  if (!g_state.buttonHandlerRegistered) {
    return;
  }

  int* payload = new int(buttonId);
  napi_status status = g_state.buttonHandler.NonBlockingCall(
      payload,
      [](Napi::Env env, Napi::Function callback, int* data) {
        if (env != nullptr && callback != nullptr && data != nullptr) {
          callback.Call({Napi::Number::New(env, *data)});
        }
        delete data;
      });
  if (status != napi_ok) {
    delete payload;
  }
}

void ActivateMainWindow() {
  HWND mainHwnd = g_state.mainHwnd;
  if (!mainHwnd || !IsWindow(mainHwnd)) {
    return;
  }
  if (IsIconic(mainHwnd)) {
    ShowWindow(mainHwnd, SW_RESTORE);
  } else {
    ShowWindow(mainHwnd, SW_SHOW);
  }
  SetForegroundWindow(mainHwnd);
}

void PaintProxyWindow(HWND hwnd) {
  PAINTSTRUCT ps = {};
  HDC paintDc = BeginPaint(hwnd, &ps);
  if (!paintDc) {
    return;
  }

  RECT client = {};
  GetClientRect(hwnd, &client);
  HBRUSH background = CreateSolidBrush(RGB(0, 0, 0));
  FillRect(paintDc, &client, background);
  DeleteObject(background);

  const int clientWidth = std::max(1, static_cast<int>(client.right - client.left));
  const int clientHeight = std::max(1, static_cast<int>(client.bottom - client.top));
  HBITMAP bitmap = RenderScaledBitmap(
      g_state.master,
      g_state.masterWidth,
      g_state.masterHeight,
      clientWidth,
      clientHeight);
  if (bitmap) {
    BITMAP bitmapInfo = {};
    GetObject(bitmap, sizeof(bitmapInfo), &bitmapInfo);
    HDC memoryDc = CreateCompatibleDC(paintDc);
    HGDIOBJ oldBitmap = SelectObject(memoryDc, bitmap);
    const int x = (clientWidth - bitmapInfo.bmWidth) / 2;
    const int y = (clientHeight - bitmapInfo.bmHeight) / 2;
    BitBlt(paintDc, x, y, bitmapInfo.bmWidth, bitmapInfo.bmHeight, memoryDc, 0, 0, SRCCOPY);
    SelectObject(memoryDc, oldBitmap);
    DeleteDC(memoryDc);
    DeleteObject(bitmap);
  }

  EndPaint(hwnd, &ps);
}

int GetProxyPlacementMode() {
  wchar_t value[32] = {};
  DWORD length = GetEnvironmentVariableW(L"ECHO_TASKBAR_PROXY_MODE", value, static_cast<DWORD>(std::size(value)));
  if (length > 0) {
    if (_wcsicmp(value, L"visible") == 0) {
      return kProxyModeVisible;
    }
    if (_wcsicmp(value, L"offscreen") == 0) {
      return kProxyModeOffscreen;
    }
    if (_wcsicmp(value, L"covered") == 0) {
      return kProxyModeCovered;
    }
  }

  wchar_t legacyVisible[8] = {};
  length = GetEnvironmentVariableW(L"ECHO_TASKBAR_PROXY_VISIBLE", legacyVisible, static_cast<DWORD>(std::size(legacyVisible)));
  if (length > 0 && legacyVisible[0] == L'1') {
    return kProxyModeVisible;
  }

  return kProxyModeCovered;
}

bool IsMainPreviewEligible() {
  return g_state.mainHwnd &&
      IsWindow(g_state.mainHwnd) &&
      IsWindowVisible(g_state.mainHwnd) &&
      !IsIconic(g_state.mainHwnd);
}

std::wstring GetWindowTitle(HWND hwnd) {
  if (!hwnd || !IsWindow(hwnd)) {
    return L"";
  }

  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0) {
    return L"";
  }

  std::wstring title(static_cast<size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, title.data(), static_cast<int>(title.size()));
  title.resize(std::max(0, copied));
  return title;
}

HICON GetMainWindowIcon(bool smallIcon) {
  if (!g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
    return nullptr;
  }

  HICON icon = nullptr;
  if (smallIcon) {
    icon = reinterpret_cast<HICON>(SendMessageW(g_state.mainHwnd, WM_GETICON, ICON_SMALL2, 0));
    if (!icon) {
      icon = reinterpret_cast<HICON>(SendMessageW(g_state.mainHwnd, WM_GETICON, ICON_SMALL, 0));
    }
  } else {
    icon = reinterpret_cast<HICON>(SendMessageW(g_state.mainHwnd, WM_GETICON, ICON_BIG, 0));
  }

  if (icon) {
    return icon;
  }

  icon = reinterpret_cast<HICON>(
      GetClassLongPtrW(g_state.mainHwnd, smallIcon ? GCLP_HICONSM : GCLP_HICON));
  if (!icon) {
    icon = reinterpret_cast<HICON>(
        GetClassLongPtrW(g_state.mainHwnd, smallIcon ? GCLP_HICON : GCLP_HICONSM));
  }
  return icon;
}

void SyncProxyIdentity() {
  if (!g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd) ||
      !g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
    return;
  }

  const std::wstring mainTitle = GetWindowTitle(g_state.mainHwnd);
  if (GetWindowTitle(g_state.proxyHwnd) != mainTitle) {
    SetWindowTextW(g_state.proxyHwnd, mainTitle.c_str());
  }

  SendMessageW(g_state.proxyHwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(GetMainWindowIcon(true)));
  SendMessageW(g_state.proxyHwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(GetMainWindowIcon(false)));
}

void PositionProxyWindow() {
  if (!g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd)) {
    return;
  }

  if (!IsMainPreviewEligible()) {
    ShowWindow(g_state.proxyHwnd, SW_HIDE);
    return;
  }

  if (g_state.proxyPlacementMode == kProxyModeVisible) {
    SetWindowPos(
        g_state.proxyHwnd,
        nullptr,
        80,
        80,
        kProxyPreviewSize,
        kProxyPreviewSize,
        SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
    return;
  }

  if (g_state.proxyPlacementMode == kProxyModeOffscreen || !g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
    SetWindowPos(
        g_state.proxyHwnd,
        nullptr,
        -32000,
        -32000,
        kProxyPreviewSize,
        kProxyPreviewSize,
        SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
    return;
  }

  RECT mainRect = {};
  if (!GetWindowRect(g_state.mainHwnd, &mainRect)) {
    return;
  }

  const int width = std::max(1, static_cast<int>(mainRect.right - mainRect.left));
  const int height = std::max(1, static_cast<int>(mainRect.bottom - mainRect.top));
  const int x = mainRect.left + std::max(0, (width - kProxyPreviewSize) / 2);
  const int y = mainRect.top + std::max(0, (height - kProxyPreviewSize) / 2);
  SetWindowPos(
      g_state.proxyHwnd,
      g_state.mainHwnd,
      x,
      y,
      kProxyPreviewSize,
      kProxyPreviewSize,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

void SyncProxyWithMainWindow() {
  if (!g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd)) {
    return;
  }

  if (!IsMainPreviewEligible()) {
    UnregisterProxyTab();
    ShowWindow(g_state.proxyHwnd, SW_HIDE);
    return;
  }

  SyncProxyIdentity();

  if (!g_state.tabRegistered && g_state.taskbar) {
    HRESULT hr = g_state.taskbar->RegisterTab(g_state.proxyHwnd, g_state.mainHwnd);
    if (SUCCEEDED(hr)) {
      g_state.tabRegistered = true;
      g_state.taskbar->SetTabOrder(g_state.proxyHwnd, nullptr);
      g_state.taskbar->SetTabActive(g_state.proxyHwnd, g_state.mainHwnd, 0);
      g_state.taskbar->SetTabProperties(g_state.proxyHwnd, STPF_USEAPPPEEKALWAYS);
      ApplyProxyButtons();
    }
  }

  PositionProxyWindow();
  InvalidateRect(g_state.proxyHwnd, nullptr, FALSE);
  UpdateWindow(g_state.proxyHwnd);
}

LRESULT CALLBACK ProxyWindowProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (g_state.taskbarButtonCreatedMessage != 0 && message == g_state.taskbarButtonCreatedMessage) {
    g_state.proxyTaskbarButtonCreated = true;
    g_state.buttonsAdded = false;
    ApplyProxyButtons();
    return 0;
  }

  switch (message) {
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT:
      PaintProxyWindow(hWnd);
      return 0;
    case WM_COMMAND:
      if (HIWORD(wParam) == THBN_CLICKED) {
        const int buttonId = LOWORD(wParam);
        if (buttonId >= kButtonPrevious && buttonId <= kButtonLike) {
          DispatchButtonClick(buttonId);
          return 0;
        }
      }
      break;
    case WM_WINDOWPOSCHANGED:
    case WM_MOVE:
    case WM_SIZE:
      PositionProxyWindow();
      break;
    case WM_ACTIVATE:
    case WM_SETFOCUS:
    case WM_LBUTTONDOWN:
      ActivateMainWindow();
      return 0;
    case WM_CLOSE:
      if (g_state.proxyPlacementMode == kProxyModeVisible) {
        DestroyWindow(hWnd);
        return 0;
      }
      if (g_state.mainHwnd && IsWindow(g_state.mainHwnd)) {
        PostMessageW(g_state.mainHwnd, WM_CLOSE, 0, 0);
      }
      return 0;
    case WM_NCDESTROY:
      if (g_state.proxyHwnd == hWnd) {
        g_state.proxyHwnd = nullptr;
        g_state.tabRegistered = false;
      }
      break;
    default:
      break;
  }
  return DefWindowProcW(hWnd, message, wParam, lParam);
}

LRESULT CALLBACK MainWindowSubclassProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam,
                                        UINT_PTR /*subclassId*/, DWORD_PTR /*refData*/) {
  switch (message) {
    case WM_SETTEXT:
    case WM_SETICON: {
      const LRESULT result = DefSubclassProc(hWnd, message, wParam, lParam);
      SyncProxyIdentity();
      return result;
    }
    case WM_WINDOWPOSCHANGED:
    case WM_MOVE:
    case WM_SIZE:
    case WM_SHOWWINDOW:
      SyncProxyWithMainWindow();
      break;
    case WM_NCDESTROY:
      RemoveWindowSubclass(hWnd, MainWindowSubclassProc, kMainSubclassId);
      g_state.mainSubclassed = false;
      break;
    default:
      break;
  }
  return DefSubclassProc(hWnd, message, wParam, lParam);
}

bool EnsureProxyWindowClass() {
  if (g_state.proxyClassRegistered) {
    return true;
  }

  if (g_state.taskbarButtonCreatedMessage == 0) {
    g_state.taskbarButtonCreatedMessage = RegisterWindowMessageW(L"TaskbarButtonCreated");
  }

  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = ProxyWindowProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = kProxyWindowClass;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);

  if (RegisterClassExW(&wc) || GetLastError() == ERROR_CLASS_ALREADY_EXISTS) {
    g_state.proxyClassRegistered = true;
    return true;
  }

  return false;
}

bool EnsureTaskbar() {
  if (g_state.taskbar) {
    return true;
  }

  const HRESULT coInit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (SUCCEEDED(coInit)) {
    g_state.comInitialized = true;
  } else if (coInit != RPC_E_CHANGED_MODE) {
    return false;
  }

  ITaskbarList4* taskbar = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&taskbar));
  if (FAILED(hr) || !taskbar) {
    if (g_state.comInitialized) {
      CoUninitialize();
      g_state.comInitialized = false;
    }
    return false;
  }

  hr = taskbar->HrInit();
  if (FAILED(hr)) {
    taskbar->Release();
    if (g_state.comInitialized) {
      CoUninitialize();
      g_state.comInitialized = false;
    }
    return false;
  }

  g_state.taskbar = taskbar;
  return true;
}

bool EnsureProxyWindow() {
  if (g_state.proxyHwnd && IsWindow(g_state.proxyHwnd)) {
    return true;
  }

  if (!g_state.mainHwnd || !IsWindow(g_state.mainHwnd) || !EnsureProxyWindowClass()) {
    return false;
  }

  const int placementMode = GetProxyPlacementMode();
  const bool visibleProbe = placementMode == kProxyModeVisible;
  const DWORD exStyle = WS_EX_TOOLWINDOW | (visibleProbe ? 0 : WS_EX_NOACTIVATE);
  const DWORD style = visibleProbe ? WS_OVERLAPPEDWINDOW : WS_POPUP;
  const int x = visibleProbe ? 80 : -32000;
  const int y = visibleProbe ? 80 : -32000;

  HWND proxy = CreateWindowExW(
      exStyle,
      kProxyWindowClass,
      visibleProbe ? L"ECHO Thumbnail Probe" : L"ECHO",
      style,
      x,
      y,
      kProxyPreviewSize,
      kProxyPreviewSize,
      nullptr,
      nullptr,
      GetModuleHandleW(nullptr),
      nullptr);
  if (!proxy) {
    return false;
  }

  g_state.proxyHwnd = proxy;
  g_state.proxyPlacementMode = placementMode;
  g_state.proxyTaskbarButtonCreated = false;
  SyncProxyIdentity();
  ShowWindow(proxy, visibleProbe ? SW_SHOWNORMAL : SW_SHOWNOACTIVATE);
  PositionProxyWindow();
  return true;
}

bool EnsureProxyRegistered() {
  if (g_state.tabRegistered) {
    return true;
  }

  if (!EnsureTaskbar() || !EnsureProxyWindow()) {
    return false;
  }

  if (!IsMainPreviewEligible()) {
    ShowWindow(g_state.proxyHwnd, SW_HIDE);
    return true;
  }

  HRESULT hr = g_state.taskbar->RegisterTab(g_state.proxyHwnd, g_state.mainHwnd);
  if (FAILED(hr)) {
    return false;
  }

  g_state.tabRegistered = true;
  SyncProxyIdentity();
  g_state.taskbar->SetTabOrder(g_state.proxyHwnd, nullptr);
  g_state.taskbar->SetTabActive(g_state.proxyHwnd, g_state.mainHwnd, 0);
  g_state.taskbar->SetTabProperties(g_state.proxyHwnd, STPF_USEAPPPEEKALWAYS);
  ApplyProxyButtons();
  return true;
}

bool EnsureProxyAttached() {
  if (!EnsureProxyRegistered()) {
    return false;
  }
  EnsureMainSubclassed();
  ApplyProxyButtons();
  return true;
}

bool EnsureMainSubclassed() {
  if (g_state.mainSubclassed) {
    return true;
  }
  if (!g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
    return false;
  }
  g_state.mainSubclassed = SetWindowSubclass(g_state.mainHwnd, MainWindowSubclassProc, kMainSubclassId, 0) != FALSE;
  return g_state.mainSubclassed;
}

bool ApplyProxyButtons() {
  if (!g_state.buttonsConfigured || !g_state.taskbar || !g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd)) {
    return true;
  }

  std::array<THUMBBUTTON, 4> buttons = {};
  std::array<HICON, 4> icons = {};
  if (!BuildThumbButtons(buttons, icons)) {
    g_state.lastButtonsHr = -1;
    return false;
  }

  HRESULT hr = g_state.buttonsAdded
      ? g_state.taskbar->ThumbBarUpdateButtons(g_state.proxyHwnd, static_cast<UINT>(buttons.size()), buttons.data())
      : g_state.taskbar->ThumbBarAddButtons(g_state.proxyHwnd, static_cast<UINT>(buttons.size()), buttons.data());
  ReleaseIcons(icons);
  g_state.lastButtonsHr = hr;
  if (SUCCEEDED(hr)) {
    g_state.buttonsAdded = true;
  }
  return SUCCEEDED(hr);
}

void UnregisterProxyTab() {
  if (g_state.taskbar && g_state.tabRegistered && g_state.proxyHwnd && IsWindow(g_state.proxyHwnd)) {
    g_state.taskbar->UnregisterTab(g_state.proxyHwnd);
  }
  g_state.tabRegistered = false;
  g_state.buttonsAdded = false;
  g_state.proxyTaskbarButtonCreated = false;
}

void DestroyProxyWindow() {
  UnregisterProxyTab();
  if (g_state.proxyHwnd && IsWindow(g_state.proxyHwnd)) {
    DestroyWindow(g_state.proxyHwnd);
  }
  g_state.proxyHwnd = nullptr;
  g_state.buttonsAdded = false;
  g_state.proxyTaskbarButtonCreated = false;
  g_state.proxyPlacementMode = kProxyModeCovered;
}

void ReleaseTaskbar() {
  if (g_state.taskbar) {
    g_state.taskbar->Release();
    g_state.taskbar = nullptr;
  }
  if (g_state.comInitialized) {
    CoUninitialize();
    g_state.comInitialized = false;
  }
}

void ReleaseButtonHandler() {
  if (g_state.buttonHandlerRegistered) {
    g_state.buttonHandler.Release();
    g_state.buttonHandlerRegistered = false;
  }
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

  if (g_state.mainHwnd != hwnd) {
    DestroyProxyWindow();
    if (g_state.mainHwnd && IsWindow(g_state.mainHwnd) && g_state.mainSubclassed) {
      RemoveWindowSubclass(g_state.mainHwnd, MainWindowSubclassProc, kMainSubclassId);
      g_state.mainSubclassed = false;
    }
    g_state.mainHwnd = hwnd;
  }
  return Napi::Boolean::New(env, true);
}

// setCover(rgbaBuffer, width, height) -> bool
Napi::Value SetCover(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_state.mainHwnd || !IsWindow(g_state.mainHwnd)) {
    return Napi::Boolean::New(env, false);
  }
  if (!StoreRgbaAsBgra(info, g_state.master, g_state.masterWidth, g_state.masterHeight)) {
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }
    return Napi::Boolean::New(env, false);
  }
  if (!EnsureProxyAttached()) {
    return Napi::Boolean::New(env, false);
  }

  if (!IsMainPreviewEligible()) {
    SyncProxyWithMainWindow();
    return Napi::Boolean::New(env, true);
  }

  PositionProxyWindow();
  InvalidateRect(g_state.proxyHwnd, nullptr, FALSE);
  UpdateWindow(g_state.proxyHwnd);
  return Napi::Boolean::New(env, true);
}

// refresh() -> bool
Napi::Value Refresh(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd) || g_state.master.empty()) {
    return Napi::Boolean::New(env, false);
  }
  SyncProxyWithMainWindow();
  if (!IsMainPreviewEligible()) {
    return Napi::Boolean::New(env, true);
  }
  InvalidateRect(g_state.proxyHwnd, nullptr, FALSE);
  UpdateWindow(g_state.proxyHwnd);
  return Napi::Boolean::New(env, true);
}

// setButtonHandler(callback) -> bool
Napi::Value SetButtonHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setButtonHandler expects a callback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  ReleaseButtonHandler();
  g_state.buttonHandler = Napi::ThreadSafeFunction::New(
      env,
      info[0].As<Napi::Function>(),
      "ECHO taskbar thumbnail buttons",
      0,
      1);
  g_state.buttonHandlerRegistered = true;
  return Napi::Boolean::New(env, true);
}

// setButtons(playing, canLike, liked, visible) -> bool
Napi::Value SetButtons(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsBoolean() || !info[1].IsBoolean() ||
      !info[2].IsBoolean() || !info[3].IsBoolean()) {
    Napi::TypeError::New(env, "setButtons expects (playing, canLike, liked, visible)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_state.buttonsPlaying = info[0].As<Napi::Boolean>().Value();
  g_state.buttonsCanLike = info[1].As<Napi::Boolean>().Value();
  g_state.buttonsLiked = info[2].As<Napi::Boolean>().Value();
  g_state.buttonsVisible = info[3].As<Napi::Boolean>().Value();
  g_state.buttonsConfigured = true;

  if (!g_state.proxyHwnd || !IsWindow(g_state.proxyHwnd)) {
    return Napi::Boolean::New(env, true);
  }
  return Napi::Boolean::New(env, ApplyProxyButtons());
}

// clear() -> bool
Napi::Value Clear(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  g_state.master.clear();
  g_state.masterWidth = 0;
  g_state.masterHeight = 0;
  g_state.buttonsAdded = false;
  DestroyProxyWindow();
  return Napi::Boolean::New(env, true);
}

// detach() -> void  (remove the proxy tab; call before the window is destroyed)
Napi::Value Detach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  g_state.master.clear();
  g_state.masterWidth = 0;
  g_state.masterHeight = 0;
  DestroyProxyWindow();
  if (g_state.mainHwnd && IsWindow(g_state.mainHwnd) && g_state.mainSubclassed) {
    RemoveWindowSubclass(g_state.mainHwnd, MainWindowSubclassProc, kMainSubclassId);
    g_state.mainSubclassed = false;
  }
  g_state.mainHwnd = nullptr;
  ReleaseTaskbar();
  ReleaseButtonHandler();
  return env.Undefined();
}

// getState() -> Object  (diagnostics: how many messages, HRESULTs, etc.)
Napi::Value GetState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("hasMaster", Napi::Boolean::New(env, !g_state.master.empty()));
  obj.Set("proxyPlacementMode", Napi::Number::New(env, g_state.proxyPlacementMode));
  obj.Set("mainSubclassed", Napi::Boolean::New(env, g_state.mainSubclassed));
  obj.Set("proxyTaskbarButtonCreated", Napi::Boolean::New(env, g_state.proxyTaskbarButtonCreated));
  obj.Set("buttonsAdded", Napi::Boolean::New(env, g_state.buttonsAdded));
  obj.Set("buttonsVisible", Napi::Boolean::New(env, g_state.buttonsVisible));
  obj.Set("buttonClicks", Napi::Number::New(env, g_state.buttonClicks));
  obj.Set("lastButtonsHr", Napi::Number::New(env, g_state.lastButtonsHr));
  return obj;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("setCover", Napi::Function::New(env, SetCover));
  exports.Set("setButtonHandler", Napi::Function::New(env, SetButtonHandler));
  exports.Set("setButtons", Napi::Function::New(env, SetButtons));
  exports.Set("refresh", Napi::Function::New(env, Refresh));
  exports.Set("clear", Napi::Function::New(env, Clear));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("getState", Napi::Function::New(env, GetState));
  return exports;
}

NODE_API_MODULE(echo_taskbar_thumbnail_helper, Init)
