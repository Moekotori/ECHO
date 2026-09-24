#include <napi.h>

#include <windows.h>
#include <dwmapi.h>
#include <shobjidl.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace {

constexpr wchar_t kWindowClass[] = L"EchoTaskbarThumbnailProxy";
constexpr UINT kPreviousButton = 1;
constexpr UINT kPlayPauseButton = 2;
constexpr UINT kNextButton = 3;
constexpr UINT kLikeButton = 4;
constexpr int kIconSize = 16;

struct State {
  HWND mainWindow = nullptr;
  HWND proxyWindow = nullptr;
  ITaskbarList4* taskbar = nullptr;
  bool classRegistered = false;
  bool tabRegistered = false;
  bool buttonsAdded = false;
  bool buttonsVisible = false;
  bool playing = false;
  bool canLike = false;
  bool liked = false;
  int width = 0;
  int height = 0;
  std::vector<std::uint8_t> pixels;
  Napi::ThreadSafeFunction buttonHandler;
  bool hasButtonHandler = false;
};

State g_state;

HBITMAP createDib(const int width, const int height, void** bits) {
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  return CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, bits, nullptr, 0);
}

HBITMAP renderThumbnail(const int maxWidth, const int maxHeight) {
  if (g_state.pixels.empty() || g_state.width <= 0 || g_state.height <= 0) {
    return nullptr;
  }

  const double scale = std::min(
      static_cast<double>(std::max(1, maxWidth)) / g_state.width,
      static_cast<double>(std::max(1, maxHeight)) / g_state.height);
  const int outputWidth = std::max(1, static_cast<int>(std::lround(g_state.width * scale)));
  const int outputHeight = std::max(1, static_cast<int>(std::lround(g_state.height * scale)));

  void* sourceBits = nullptr;
  HBITMAP source = createDib(g_state.width, g_state.height, &sourceBits);
  if (!source || !sourceBits) {
    if (source) DeleteObject(source);
    return nullptr;
  }
  std::memcpy(sourceBits, g_state.pixels.data(), g_state.pixels.size());

  void* outputBits = nullptr;
  HBITMAP output = createDib(outputWidth, outputHeight, &outputBits);
  if (!output || !outputBits) {
    DeleteObject(source);
    if (output) DeleteObject(output);
    return nullptr;
  }

  HDC screen = GetDC(nullptr);
  HDC sourceDc = CreateCompatibleDC(screen);
  HDC outputDc = CreateCompatibleDC(screen);
  HGDIOBJ oldSource = SelectObject(sourceDc, source);
  HGDIOBJ oldOutput = SelectObject(outputDc, output);
  SetStretchBltMode(outputDc, HALFTONE);
  SetBrushOrgEx(outputDc, 0, 0, nullptr);
  StretchBlt(outputDc, 0, 0, outputWidth, outputHeight, sourceDc, 0, 0,
             g_state.width, g_state.height, SRCCOPY);
  GdiFlush();

  auto* bytes = static_cast<std::uint8_t*>(outputBits);
  const std::size_t pixelCount = static_cast<std::size_t>(outputWidth) * outputHeight;
  for (std::size_t index = 0; index < pixelCount; ++index) {
    bytes[index * 4 + 3] = 0xff;
  }

  SelectObject(sourceDc, oldSource);
  SelectObject(outputDc, oldOutput);
  DeleteDC(sourceDc);
  DeleteDC(outputDc);
  ReleaseDC(nullptr, screen);
  DeleteObject(source);
  return output;
}

using PixelPredicate = bool (*)(int, int);

HICON createIcon(const PixelPredicate predicate, const COLORREF color) {
  void* bits = nullptr;
  HBITMAP bitmap = createDib(kIconSize, kIconSize, &bits);
  if (!bitmap || !bits) {
    if (bitmap) DeleteObject(bitmap);
    return nullptr;
  }

  auto* bytes = static_cast<std::uint8_t*>(bits);
  for (int y = 0; y < kIconSize; ++y) {
    for (int x = 0; x < kIconSize; ++x) {
      const bool filled = predicate(x, y);
      const int offset = (y * kIconSize + x) * 4;
      bytes[offset] = GetBValue(color);
      bytes[offset + 1] = GetGValue(color);
      bytes[offset + 2] = GetRValue(color);
      bytes[offset + 3] = filled ? 0xff : 0;
    }
  }

  HBITMAP mask = CreateBitmap(kIconSize, kIconSize, 1, 1, nullptr);
  ICONINFO info{};
  info.fIcon = TRUE;
  info.hbmColor = bitmap;
  info.hbmMask = mask;
  HICON icon = mask ? CreateIconIndirect(&info) : nullptr;
  DeleteObject(bitmap);
  if (mask) DeleteObject(mask);
  return icon;
}

bool previousShape(const int x, const int y) {
  const bool bar = x >= 2 && x <= 3 && y >= 3 && y <= 12;
  const bool triangle = x >= 4 && x <= 12 && y >= 3 && y <= 12 &&
      std::abs(y - 7) <= (x - 4) / 2 + 1;
  return bar || triangle;
}

bool nextShape(const int x, const int y) {
  return previousShape(15 - x, y);
}

bool playShape(const int x, const int y) {
  return x >= 4 && x <= 12 && y >= 2 && y <= 13 && std::abs(y - 7) <= (x - 4) / 2 + 1;
}

bool pauseShape(const int x, const int y) {
  return y >= 2 && y <= 13 && ((x >= 4 && x <= 6) || (x >= 10 && x <= 12));
}

bool heartOutlineShape(const int x, const int y) {
  const double nx = (x - 7.5) / 7.0;
  const double ny = (7.0 - y) / 7.0;
  const double expression = std::pow(nx * nx + ny * ny - 0.45, 3) - nx * nx * std::pow(ny, 3);
  const double innerExpression = std::pow(nx * nx + ny * ny - 0.27, 3) - nx * nx * std::pow(ny, 3);
  return expression <= 0.0 && innerExpression >= 0.0;
}

bool heartFilledShape(const int x, const int y) {
  const double nx = (x - 7.5) / 7.0;
  const double ny = (7.0 - y) / 7.0;
  return std::pow(nx * nx + ny * ny - 0.45, 3) - nx * nx * std::pow(ny, 3) <= 0.0;
}

void destroyIcons(std::array<HICON, 4>& icons) {
  for (HICON icon : icons) {
    if (icon) DestroyIcon(icon);
  }
}

bool applyButtons() {
  if (!g_state.taskbar || !g_state.proxyWindow || !g_state.tabRegistered) {
    return false;
  }

  const COLORREF normal = RGB(32, 41, 67);
  const COLORREF accent = RGB(220, 38, 72);
  std::array<HICON, 4> icons{
      createIcon(previousShape, normal),
      createIcon(g_state.playing ? pauseShape : playShape, normal),
      createIcon(nextShape, normal),
      createIcon(g_state.liked ? heartFilledShape : heartOutlineShape, g_state.liked ? accent : normal),
  };
  if (std::any_of(icons.begin(), icons.end(), [](HICON icon) { return icon == nullptr; })) {
    destroyIcons(icons);
    return false;
  }

  std::array<THUMBBUTTON, 4> buttons{};
  const std::array<UINT, 4> ids{kPreviousButton, kPlayPauseButton, kNextButton, kLikeButton};
  const std::array<const wchar_t*, 4> labels{
      L"Previous", g_state.playing ? L"Pause" : L"Play", L"Next", g_state.liked ? L"Unlike" : L"Like"};
  for (std::size_t index = 0; index < buttons.size(); ++index) {
    buttons[index].dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
    buttons[index].iId = ids[index];
    buttons[index].hIcon = icons[index];
    wcsncpy_s(buttons[index].szTip, labels[index], _TRUNCATE);
    if (!g_state.buttonsVisible || (ids[index] == kLikeButton && !g_state.canLike)) {
      buttons[index].dwFlags = ids[index] == kLikeButton && g_state.buttonsVisible
          ? THBF_DISABLED
          : static_cast<THUMBBUTTONFLAGS>(THBF_HIDDEN | THBF_DISABLED);
    } else {
      buttons[index].dwFlags = THBF_ENABLED;
    }
  }

  HRESULT result = g_state.buttonsAdded
      ? g_state.taskbar->ThumbBarUpdateButtons(g_state.proxyWindow, static_cast<UINT>(buttons.size()), buttons.data())
      : g_state.taskbar->ThumbBarAddButtons(g_state.proxyWindow, static_cast<UINT>(buttons.size()), buttons.data());
  if (SUCCEEDED(result)) g_state.buttonsAdded = true;
  destroyIcons(icons);
  return SUCCEEDED(result);
}

void emitButtonClick(const UINT buttonId) {
  if (!g_state.hasButtonHandler) return;
  auto* payload = new UINT(buttonId);
  const napi_status status = g_state.buttonHandler.NonBlockingCall(
      payload, [](Napi::Env env, Napi::Function callback, UINT* value) {
        callback.Call({Napi::Number::New(env, *value)});
        delete value;
      });
  if (status != napi_ok) delete payload;
}

LRESULT CALLBACK proxyWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_DWMSENDICONICTHUMBNAIL) {
    HBITMAP bitmap = renderThumbnail(HIWORD(lParam), LOWORD(lParam));
    if (bitmap) {
      DwmSetIconicThumbnail(window, bitmap, DWM_SIT_DISPLAYFRAME);
      DeleteObject(bitmap);
    }
    return 0;
  }
  if (message == WM_COMMAND && HIWORD(wParam) == THBN_CLICKED) {
    emitButtonClick(LOWORD(wParam));
    return 0;
  }
  if (message == WM_ACTIVATE && LOWORD(wParam) != WA_INACTIVE && IsWindow(g_state.mainWindow)) {
    ShowWindow(g_state.mainWindow, SW_RESTORE);
    SetForegroundWindow(g_state.mainWindow);
    return 0;
  }
  if (message == WM_CLOSE) {
    if (IsWindow(g_state.mainWindow)) {
      ShowWindow(g_state.mainWindow, SW_RESTORE);
      SetForegroundWindow(g_state.mainWindow);
    }
    return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

bool ensureTaskbar() {
  if (g_state.taskbar) return true;
  const HRESULT coResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(coResult) && coResult != RPC_E_CHANGED_MODE) return false;
  HRESULT result = CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&g_state.taskbar));
  if (FAILED(result) || !g_state.taskbar) return false;
  result = g_state.taskbar->HrInit();
  if (FAILED(result)) {
    g_state.taskbar->Release();
    g_state.taskbar = nullptr;
    return false;
  }
  return true;
}

bool ensureWindowClass() {
  if (g_state.classRegistered) return true;
  WNDCLASSEXW windowClass{};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.lpfnWndProc = proxyWindowProc;
  windowClass.lpszClassName = kWindowClass;
  windowClass.hCursor = LoadCursor(nullptr, IDC_ARROW);
  const ATOM atom = RegisterClassExW(&windowClass);
  if (!atom && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
  g_state.classRegistered = true;
  return true;
}

void destroyProxy() {
  if (g_state.taskbar && g_state.proxyWindow && g_state.tabRegistered) {
    g_state.taskbar->UnregisterTab(g_state.proxyWindow);
  }
  g_state.tabRegistered = false;
  g_state.buttonsAdded = false;
  if (g_state.proxyWindow) DestroyWindow(g_state.proxyWindow);
  g_state.proxyWindow = nullptr;
}

bool ensureProxy() {
  if (g_state.proxyWindow && g_state.tabRegistered) return true;
  if (!IsWindow(g_state.mainWindow) || !ensureTaskbar() || !ensureWindowClass()) return false;

  RECT bounds{};
  GetWindowRect(g_state.mainWindow, &bounds);
  g_state.proxyWindow = CreateWindowExW(
      WS_EX_NOACTIVATE, kWindowClass, L"ECHO NEXT", WS_POPUP,
      bounds.left, bounds.top, 256, 256, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!g_state.proxyWindow) return false;

  const BOOL enabled = TRUE;
  DwmSetWindowAttribute(g_state.proxyWindow, DWMWA_FORCE_ICONIC_REPRESENTATION, &enabled, sizeof(enabled));
  DwmSetWindowAttribute(g_state.proxyWindow, DWMWA_HAS_ICONIC_BITMAP, &enabled, sizeof(enabled));

  HRESULT result = g_state.taskbar->RegisterTab(g_state.proxyWindow, g_state.mainWindow);
  if (FAILED(result)) {
    destroyProxy();
    return false;
  }
  g_state.tabRegistered = true;
  g_state.taskbar->SetTabOrder(g_state.proxyWindow, nullptr);
  g_state.taskbar->SetTabProperties(g_state.proxyWindow, STPF_USEAPPPEEKALWAYS);
  g_state.taskbar->SetTabActive(g_state.proxyWindow, g_state.mainWindow, 0);

  ShowWindow(g_state.proxyWindow, SW_SHOWNOACTIVATE);
  SetWindowPos(g_state.proxyWindow, g_state.mainWindow, bounds.left, bounds.top, 256, 256,
               SWP_NOACTIVATE | SWP_NOOWNERZORDER);
  DwmInvalidateIconicBitmaps(g_state.proxyWindow);
  applyButtons();
  return true;
}

Napi::Value attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) return Napi::Boolean::New(env, false);
  const auto buffer = info[0].As<Napi::Buffer<std::uint8_t>>();
  if (buffer.Length() < sizeof(HWND)) return Napi::Boolean::New(env, false);
  HWND mainWindow = nullptr;
  std::memcpy(&mainWindow, buffer.Data(), sizeof(HWND));
  if (!IsWindow(mainWindow)) return Napi::Boolean::New(env, false);
  if (g_state.mainWindow != mainWindow) destroyProxy();
  g_state.mainWindow = mainWindow;
  return Napi::Boolean::New(env, true);
}

Napi::Value setCover(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }
  const auto input = info[0].As<Napi::Buffer<std::uint8_t>>();
  const int width = info[1].As<Napi::Number>().Int32Value();
  const int height = info[2].As<Napi::Number>().Int32Value();
  if (width <= 0 || height <= 0 || input.Length() != static_cast<std::size_t>(width) * height * 4) {
    return Napi::Boolean::New(env, false);
  }

  g_state.pixels.resize(input.Length());
  for (std::size_t index = 0; index < input.Length(); index += 4) {
    g_state.pixels[index] = input[index + 2];
    g_state.pixels[index + 1] = input[index + 1];
    g_state.pixels[index + 2] = input[index];
    g_state.pixels[index + 3] = 0xff;
  }
  g_state.width = width;
  g_state.height = height;
  const bool ready = ensureProxy();
  if (ready) DwmInvalidateIconicBitmaps(g_state.proxyWindow);
  return Napi::Boolean::New(env, ready);
}

Napi::Value setButtons(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) return Napi::Boolean::New(env, false);
  g_state.playing = info[0].ToBoolean().Value();
  g_state.canLike = info[1].ToBoolean().Value();
  g_state.liked = info[2].ToBoolean().Value();
  g_state.buttonsVisible = info[3].ToBoolean().Value();
  if (!g_state.proxyWindow) return Napi::Boolean::New(env, true);
  return Napi::Boolean::New(env, applyButtons());
}

Napi::Value setButtonHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) return Napi::Boolean::New(env, false);
  if (g_state.hasButtonHandler) {
    g_state.buttonHandler.Release();
    g_state.hasButtonHandler = false;
  }
  g_state.buttonHandler = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "taskbarThumbnailButtons", 0, 1);
  g_state.hasButtonHandler = true;
  return Napi::Boolean::New(env, true);
}

Napi::Value clear(const Napi::CallbackInfo& info) {
  destroyProxy();
  g_state.pixels.clear();
  g_state.width = 0;
  g_state.height = 0;
  return info.Env().Undefined();
}

Napi::Value detach(const Napi::CallbackInfo& info) {
  destroyProxy();
  g_state.pixels.clear();
  g_state.mainWindow = nullptr;
  if (g_state.taskbar) {
    g_state.taskbar->Release();
    g_state.taskbar = nullptr;
  }
  if (g_state.hasButtonHandler) {
    g_state.buttonHandler.Release();
    g_state.hasButtonHandler = false;
  }
  return info.Env().Undefined();
}

Napi::Object initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, attach));
  exports.Set("setCover", Napi::Function::New(env, setCover));
  exports.Set("setButtons", Napi::Function::New(env, setButtons));
  exports.Set("setButtonHandler", Napi::Function::New(env, setButtonHandler));
  exports.Set("clear", Napi::Function::New(env, clear));
  exports.Set("detach", Napi::Function::New(env, detach));
  return exports;
}

}  // namespace

NODE_API_MODULE(echo_taskbar_thumbnail_helper, initialize)
