#include "connection_dialog.hpp"

#include <windows.h>

#include <string>

namespace crate::vdj {
namespace {

constexpr int kOriginId = 101;
constexpr int kTokenId = 102;
constexpr int kConnectId = 103;
constexpr int kCancelId = 104;
constexpr int kDisconnectId = 105;
constexpr wchar_t kWindowClass[] = L"CrateConnectionDialog";

std::wstring to_wide(const std::string& value)
{
    if (value.empty()) {
        return {};
    }
    const int length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring result(length, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
    return result;
}

std::string from_wide(const std::wstring& value)
{
    if (value.empty()) {
        return {};
    }
    const int length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(length, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
    return result;
}

std::wstring window_text(HWND window)
{
    const int length = GetWindowTextLengthW(window);
    std::wstring text(length + 1, L'\0');
    GetWindowTextW(window, text.data(), length + 1);
    text.resize(length);
    return text;
}

struct DialogState {
    ConnectionDialogResult result;
    bool done = false;
};

LRESULT CALLBACK dialog_procedure(HWND window, UINT message, WPARAM wparam, LPARAM lparam)
{
    auto* state = reinterpret_cast<DialogState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_CREATE) {
        const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
        return 0;
    }
    if (message == WM_COMMAND && state != nullptr) {
        const int id = LOWORD(wparam);
        if (id == kConnectId) {
            state->result.action = ConnectionDialogAction::Connect;
            state->result.origin = from_wide(window_text(GetDlgItem(window, kOriginId)));
            state->result.token = from_wide(window_text(GetDlgItem(window, kTokenId)));
            SetWindowTextW(GetDlgItem(window, kTokenId), L"");
        } else if (id == kDisconnectId) {
            state->result.action = ConnectionDialogAction::Disconnect;
        } else if (id != kCancelId) {
            return DefWindowProcW(window, message, wparam, lparam);
        }
        state->done = true;
        DestroyWindow(window);
        return 0;
    }
    if (message == WM_CLOSE && state != nullptr) {
        state->done = true;
        DestroyWindow(window);
        return 0;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

HWND add_control(HWND parent, const wchar_t* type, const wchar_t* text, DWORD style, int id, int x, int y, int width, int height)
{
    return CreateWindowExW(
        type == std::wstring(L"EDIT") ? WS_EX_CLIENTEDGE : 0,
        type,
        text,
        WS_CHILD | WS_VISIBLE | WS_TABSTOP | style,
        x,
        y,
        width,
        height,
        parent,
        reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
        GetModuleHandleW(nullptr),
        nullptr
    );
}

} // namespace

ConnectionDialogResult show_connection_dialog(const ConnectionDialogRequest& request)
{
    DialogState state;
    WNDCLASSW window_class{};
    window_class.lpfnWndProc = dialog_procedure;
    window_class.hInstance = GetModuleHandleW(nullptr);
    window_class.lpszClassName = kWindowClass;
    window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    RegisterClassW(&window_class);

    HWND window = CreateWindowExW(
        WS_EX_DLGMODALFRAME | WS_EX_TOPMOST,
        kWindowClass,
        L"Connect to Crate",
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        460,
        250,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        &state
    );
    if (window == nullptr) {
        return state.result;
    }
    add_control(window, L"STATIC", to_wide(kConnectionDialogExplanation).c_str(), 0, 0, 16, 12, 420, 48);
    add_control(window, L"STATIC", L"Server address", 0, 0, 16, 66, 420, 18);
    add_control(window, L"EDIT", to_wide(request.current_origin).c_str(), ES_AUTOHSCROLL, kOriginId, 16, 86, 420, 24);
    add_control(window, L"STATIC", L"Access token", 0, 0, 16, 116, 420, 18);
    add_control(window, L"EDIT", L"", ES_AUTOHSCROLL | ES_PASSWORD, kTokenId, 16, 136, 420, 24);
    add_control(window, L"BUTTON", L"Connect", BS_DEFPUSHBUTTON, kConnectId, 236, 176, 96, 28);
    add_control(window, L"BUTTON", L"Cancel", BS_PUSHBUTTON, kCancelId, 340, 176, 96, 28);
    if (!request.current_origin.empty()) {
        add_control(window, L"BUTTON", L"Disconnect", BS_PUSHBUTTON, kDisconnectId, 16, 176, 96, 28);
    }
    ShowWindow(window, SW_SHOW);

    MSG message;
    while (!state.done && GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (!IsDialogMessageW(window, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    return state.result;
}

void show_connection_message(const std::string& title, const std::string& message)
{
    MessageBoxW(nullptr, to_wide(message).c_str(), to_wide(title).c_str(), MB_OK | MB_ICONINFORMATION | MB_TOPMOST);
}

} // namespace crate::vdj
