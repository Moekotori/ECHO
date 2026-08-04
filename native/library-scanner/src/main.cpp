#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;

struct ScanRequest {
  std::string root;
  std::vector<std::string> extensions;
  std::size_t batchSize = 256;
};

struct ScanItem {
  std::string path;
  std::uintmax_t sizeBytes = 0;
  std::int64_t mtimeMs = 0;
};

struct SnapshotEntry {
  std::string name;
  std::string kind;
};

struct NativeMetadataResult {
  std::string title;
  std::string artist;
  std::string album;
  std::string albumArtist;
  std::optional<int> trackNo;
  std::optional<int> discNo;
  std::optional<int> year;
  std::optional<std::string> genre;
  double duration = 0;
  std::optional<int> sampleRate;
  std::optional<int> bitDepth;
  std::optional<int> bitrate;
  std::string codec = "FLAC";
  bool hasVorbisComments = false;
  std::map<std::string, std::string> sources;
};

struct Mp3StreamInfo {
  double duration = 0;
  int sampleRate = 0;
  int bitrate = 0;
};

static std::string jsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (ch < 0x20) {
          constexpr char hex[] = "0123456789abcdef";
          escaped += "\\u00";
          escaped += hex[(ch >> 4) & 0x0f];
          escaped += hex[ch & 0x0f];
        } else {
          escaped += static_cast<char>(ch);
        }
        break;
    }
  }
  return escaped;
}

static std::optional<std::string> parseJsonStringAt(const std::string& input, std::size_t quoteIndex, std::size_t* endIndex = nullptr) {
  if (quoteIndex >= input.size() || input[quoteIndex] != '"') {
    return std::nullopt;
  }

  std::string value;
  for (std::size_t index = quoteIndex + 1; index < input.size(); index += 1) {
    const char ch = input[index];
    if (ch == '"') {
      if (endIndex) {
        *endIndex = index + 1;
      }
      return value;
    }
    if (ch != '\\') {
      value += ch;
      continue;
    }
    if (index + 1 >= input.size()) {
      return std::nullopt;
    }
    const char escaped = input[++index];
    switch (escaped) {
      case '"':
      case '\\':
      case '/':
        value += escaped;
        break;
      case 'b':
        value += '\b';
        break;
      case 'f':
        value += '\f';
        break;
      case 'n':
        value += '\n';
        break;
      case 'r':
        value += '\r';
        break;
      case 't':
        value += '\t';
        break;
      default:
        return std::nullopt;
    }
  }

  return std::nullopt;
}

static std::optional<std::size_t> findFieldValue(const std::string& input, const std::string& fieldName) {
  const std::string needle = "\"" + fieldName + "\"";
  const std::size_t fieldIndex = input.find(needle);
  if (fieldIndex == std::string::npos) {
    return std::nullopt;
  }
  const std::size_t colonIndex = input.find(':', fieldIndex + needle.size());
  if (colonIndex == std::string::npos) {
    return std::nullopt;
  }
  std::size_t valueIndex = colonIndex + 1;
  while (valueIndex < input.size() && std::isspace(static_cast<unsigned char>(input[valueIndex]))) {
    valueIndex += 1;
  }
  return valueIndex;
}

static std::string trimAsciiWhitespace(const std::string& value) {
  std::size_t begin = 0;
  while (begin < value.size() && std::isspace(static_cast<unsigned char>(value[begin]))) {
    begin += 1;
  }

  std::size_t end = value.size();
  while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
    end -= 1;
  }

  return value.substr(begin, end - begin);
}

static bool isSafeMetadataText(const std::string& value) {
  if (value.empty() || value.size() > 512) {
    return false;
  }

  std::size_t controlCount = 0;
  for (unsigned char ch : value) {
    if ((ch <= 0x1f && ch != '\t') || ch == 0x7f) {
      controlCount += 1;
    }
  }
  return controlCount == 0;
}

static std::optional<std::string> cleanMetadataText(const std::string& value) {
  const std::string trimmed = trimAsciiWhitespace(value);
  return isSafeMetadataText(trimmed) ? std::optional<std::string>(trimmed) : std::nullopt;
}

static std::optional<std::string> parseStringField(const std::string& input, const std::string& fieldName) {
  const auto valueIndex = findFieldValue(input, fieldName);
  return valueIndex ? parseJsonStringAt(input, *valueIndex) : std::nullopt;
}

static std::vector<std::string> parseStringArrayField(const std::string& input, const std::string& fieldName) {
  std::vector<std::string> values;
  const auto valueIndex = findFieldValue(input, fieldName);
  if (!valueIndex || *valueIndex >= input.size() || input[*valueIndex] != '[') {
    return values;
  }

  for (std::size_t index = *valueIndex + 1; index < input.size();) {
    while (index < input.size() && std::isspace(static_cast<unsigned char>(input[index]))) {
      index += 1;
    }
    if (index >= input.size() || input[index] == ']') {
      break;
    }
    std::size_t endIndex = index;
    auto value = parseJsonStringAt(input, index, &endIndex);
    if (!value) {
      break;
    }
    values.push_back(*value);
    index = endIndex;
    while (index < input.size() && (std::isspace(static_cast<unsigned char>(input[index])) || input[index] == ',')) {
      index += 1;
    }
  }

  return values;
}

static std::size_t parseSizeField(const std::string& input, const std::string& fieldName, std::size_t fallback) {
  const auto valueIndex = findFieldValue(input, fieldName);
  if (!valueIndex) {
    return fallback;
  }

  std::size_t index = *valueIndex;
  std::size_t value = 0;
  bool hasDigit = false;
  while (index < input.size() && std::isdigit(static_cast<unsigned char>(input[index]))) {
    hasDigit = true;
    value = value * 10 + static_cast<std::size_t>(input[index] - '0');
    index += 1;
  }
  return hasDigit ? value : fallback;
}

static bool readExact(std::ifstream& stream, unsigned char* buffer, std::size_t size) {
  stream.read(reinterpret_cast<char*>(buffer), static_cast<std::streamsize>(size));
  return stream.good() || static_cast<std::size_t>(stream.gcount()) == size;
}

static bool readExact(std::ifstream& stream, std::vector<unsigned char>& buffer) {
  if (buffer.empty()) {
    return true;
  }
  return readExact(stream, buffer.data(), buffer.size());
}

static std::uint32_t readLe32(const unsigned char* bytes) {
  return static_cast<std::uint32_t>(bytes[0]) |
    (static_cast<std::uint32_t>(bytes[1]) << 8U) |
    (static_cast<std::uint32_t>(bytes[2]) << 16U) |
    (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

static std::uint16_t readLe16(const unsigned char* bytes) {
  return static_cast<std::uint16_t>(bytes[0] | (bytes[1] << 8U));
}

static std::uint64_t readLe64(const unsigned char* bytes) {
  std::uint64_t value = 0;
  for (int index = 7; index >= 0; index -= 1) {
    value = (value << 8U) | static_cast<std::uint64_t>(bytes[index]);
  }
  return value;
}

static std::uint32_t readBe24(const unsigned char* bytes) {
  return (static_cast<std::uint32_t>(bytes[0]) << 16U) |
    (static_cast<std::uint32_t>(bytes[1]) << 8U) |
    static_cast<std::uint32_t>(bytes[2]);
}

static std::uint32_t readBe32(const unsigned char* bytes) {
  return (static_cast<std::uint32_t>(bytes[0]) << 24U) |
    (static_cast<std::uint32_t>(bytes[1]) << 16U) |
    (static_cast<std::uint32_t>(bytes[2]) << 8U) |
    static_cast<std::uint32_t>(bytes[3]);
}

static std::uint16_t readBe16(const unsigned char* bytes) {
  return static_cast<std::uint16_t>((bytes[0] << 8U) | bytes[1]);
}

static std::optional<std::uint32_t> readSynchsafe32(const unsigned char* bytes) {
  if ((bytes[0] & 0x80U) != 0 || (bytes[1] & 0x80U) != 0 || (bytes[2] & 0x80U) != 0 || (bytes[3] & 0x80U) != 0) {
    return std::nullopt;
  }
  return (static_cast<std::uint32_t>(bytes[0]) << 21U) |
    (static_cast<std::uint32_t>(bytes[1]) << 14U) |
    (static_cast<std::uint32_t>(bytes[2]) << 7U) |
    static_cast<std::uint32_t>(bytes[3]);
}

static std::uint64_t readBe64(const unsigned char* bytes) {
  std::uint64_t value = 0;
  for (int index = 0; index < 8; index += 1) {
    value = (value << 8U) | static_cast<std::uint64_t>(bytes[index]);
  }
  return value;
}

static std::optional<int> parseLeadingPositiveInt(const std::string& value) {
  int parsed = 0;
  bool hasDigit = false;
  for (unsigned char ch : value) {
    if (!std::isdigit(ch)) {
      break;
    }
    hasDigit = true;
    parsed = parsed * 10 + static_cast<int>(ch - '0');
    if (parsed > 1000000) {
      return std::nullopt;
    }
  }
  return hasDigit && parsed > 0 ? std::optional<int>(parsed) : std::nullopt;
}

static std::optional<int> parseYear(const std::string& value) {
  int parsed = 0;
  int digits = 0;
  for (unsigned char ch : value) {
    if (std::isdigit(ch)) {
      parsed = parsed * 10 + static_cast<int>(ch - '0');
      digits += 1;
      if (digits == 4) {
        return parsed >= 1000 && parsed <= 9999 ? std::optional<int>(parsed) : std::nullopt;
      }
      continue;
    }

    if (digits > 0) {
      return std::nullopt;
    }
  }
  return std::nullopt;
}

static std::string firstTagValue(const std::map<std::string, std::vector<std::string>>& tags, const std::string& key) {
  const auto found = tags.find(key);
  if (found == tags.end() || found->second.empty()) {
    return "";
  }
  return found->second.front();
}

static std::string joinedTagValue(const std::map<std::string, std::vector<std::string>>& tags, const std::string& key) {
  const auto found = tags.find(key);
  if (found == tags.end() || found->second.empty()) {
    return "";
  }

  std::string joined;
  for (const std::string& value : found->second) {
    if (!joined.empty()) {
      joined += "; ";
    }
    joined += value;
  }
  return joined;
}

static void appendUtf8CodePoint(std::string& output, std::uint32_t codePoint) {
  if (codePoint <= 0x7fU) {
    output += static_cast<char>(codePoint);
  } else if (codePoint <= 0x7ffU) {
    output += static_cast<char>(0xc0U | ((codePoint >> 6U) & 0x1fU));
    output += static_cast<char>(0x80U | (codePoint & 0x3fU));
  } else if (codePoint <= 0xffffU) {
    output += static_cast<char>(0xe0U | ((codePoint >> 12U) & 0x0fU));
    output += static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3fU));
    output += static_cast<char>(0x80U | (codePoint & 0x3fU));
  } else if (codePoint <= 0x10ffffU) {
    output += static_cast<char>(0xf0U | ((codePoint >> 18U) & 0x07U));
    output += static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3fU));
    output += static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3fU));
    output += static_cast<char>(0x80U | (codePoint & 0x3fU));
  }
}

static std::string latin1ToUtf8(const unsigned char* bytes, std::size_t size) {
  std::string output;
  output.reserve(size);
  for (std::size_t index = 0; index < size; index += 1) {
    appendUtf8CodePoint(output, bytes[index]);
  }
  return output;
}

static std::string utf16ToUtf8(const unsigned char* bytes, std::size_t size, bool littleEndian) {
  std::string output;
  output.reserve(size);
  for (std::size_t index = 0; index + 1 < size; index += 2) {
    const std::uint16_t unit = littleEndian
      ? static_cast<std::uint16_t>(bytes[index] | (bytes[index + 1] << 8U))
      : static_cast<std::uint16_t>((bytes[index] << 8U) | bytes[index + 1]);
    if (unit == 0) {
      break;
    }

    if (unit >= 0xd800U && unit <= 0xdbffU && index + 3 < size) {
      const std::uint16_t low = littleEndian
        ? static_cast<std::uint16_t>(bytes[index + 2] | (bytes[index + 3] << 8U))
        : static_cast<std::uint16_t>((bytes[index + 2] << 8U) | bytes[index + 3]);
      if (low >= 0xdc00U && low <= 0xdfffU) {
        const std::uint32_t codePoint = 0x10000U + (((unit - 0xd800U) << 10U) | (low - 0xdc00U));
        appendUtf8CodePoint(output, codePoint);
        index += 2;
        continue;
      }
    }

    if (unit < 0xd800U || unit > 0xdfffU) {
      appendUtf8CodePoint(output, unit);
    }
  }
  return output;
}

static std::optional<std::string> decodeId3TextFrame(const std::vector<unsigned char>& frame) {
  if (frame.empty()) {
    return std::nullopt;
  }

  const unsigned char encoding = frame[0];
  const unsigned char* bytes = frame.data() + 1;
  std::size_t size = frame.size() - 1;
  while (size > 0 && bytes[size - 1] == 0) {
    size -= 1;
  }

  std::string decoded;
  if (encoding == 0) {
    decoded = latin1ToUtf8(bytes, size);
  } else if (encoding == 3) {
    decoded.assign(reinterpret_cast<const char*>(bytes), size);
  } else if (encoding == 1 || encoding == 2) {
    bool littleEndian = false;
    if (encoding == 1 && size >= 2) {
      if (bytes[0] == 0xff && bytes[1] == 0xfe) {
        littleEndian = true;
        bytes += 2;
        size -= 2;
      } else if (bytes[0] == 0xfe && bytes[1] == 0xff) {
        bytes += 2;
        size -= 2;
      } else {
        littleEndian = true;
      }
    }
    decoded = utf16ToUtf8(bytes, size, littleEndian);
  } else {
    return std::nullopt;
  }

  const std::size_t nullIndex = decoded.find('\0');
  if (nullIndex != std::string::npos) {
    decoded.resize(nullIndex);
  }
  return cleanMetadataText(decoded);
}

static void addTextTag(std::map<std::string, std::vector<std::string>>& tags, const std::string& key, const std::optional<std::string>& value) {
  if (value) {
    tags[key].push_back(*value);
  }
}

static void initializeTechnicalSources(
  NativeMetadataResult& result,
  const std::string& codec,
  const std::string& codecSource = "technical"
) {
  result.codec = codec;
  result.sources["duration"] = "unknown";
  result.sources["codec"] = codecSource;
  result.sources["sampleRate"] = "unknown";
  result.sources["bitDepth"] = "unknown";
  result.sources["bitrate"] = "unknown";
  result.sources["bpm"] = "unknown";
  result.sources["replayGainTrackGainDb"] = "unknown";
  result.sources["replayGainAlbumGainDb"] = "unknown";
  result.sources["replayGainTrackPeak"] = "unknown";
  result.sources["replayGainAlbumPeak"] = "unknown";
  result.sources["replayGainIntegratedLufs"] = "unknown";
}

static std::optional<std::string> cleanChunkText(const unsigned char* bytes, std::size_t size) {
  while (size > 0 && (bytes[size - 1] == 0 || bytes[size - 1] == ' ')) {
    size -= 1;
  }
  return cleanMetadataText(std::string(reinterpret_cast<const char*>(bytes), size));
}

static void addRiffInfoTag(std::map<std::string, std::vector<std::string>>& tags, const std::string& id, const std::optional<std::string>& value) {
  if (id == "INAM") {
    addTextTag(tags, "title", value);
  } else if (id == "IART") {
    addTextTag(tags, "artist", value);
  } else if (id == "IPRD") {
    addTextTag(tags, "album", value);
  } else if (id == "IGNR") {
    addTextTag(tags, "genre", value);
  } else if (id == "ITRK") {
    addTextTag(tags, "tracknumber", value);
  } else if (id == "ICRD" || id == "IYEAR") {
    addTextTag(tags, "date", value);
  }
}

#ifdef _WIN32
static std::wstring utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int required = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (required <= 0) {
    return {};
  }
  std::wstring wide(static_cast<std::size_t>(required), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), wide.data(), required);
  return wide;
}

static std::string wideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  const int required = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) {
    return {};
  }
  std::string utf8(static_cast<std::size_t>(required), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), utf8.data(), required, nullptr, nullptr);
  return utf8;
}

static std::string win32ErrorMessage(DWORD errorCode) {
  LPWSTR buffer = nullptr;
  const DWORD length = FormatMessageW(
    FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr,
    errorCode,
    MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    reinterpret_cast<LPWSTR>(&buffer),
    0,
    nullptr
  );
  std::string message = "Win32 error " + std::to_string(errorCode);
  if (length > 0 && buffer) {
    std::wstring wide(buffer, length);
    while (!wide.empty() && (wide.back() == L'\r' || wide.back() == L'\n' || wide.back() == L' ' || wide.back() == L'\t')) {
      wide.pop_back();
    }
    message += ": " + wideToUtf8(wide);
  }
  if (buffer) {
    LocalFree(buffer);
  }
  return message;
}
#endif

static fs::path pathFromUtf8(const std::string& value) {
#ifdef _WIN32
  return fs::path(utf8ToWide(value));
#else
  return fs::path(value);
#endif
}

static std::string pathToUtf8(const fs::path& path) {
#ifdef _WIN32
  return wideToUtf8(path.wstring());
#else
  const auto raw = path.u8string();
  return std::string(raw.begin(), raw.end());
#endif
}

static std::string asciiLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

static std::int64_t fileTimeToUnixMs(const fs::file_time_type& fileTime) {
  const auto systemTime = std::chrono::time_point_cast<std::chrono::milliseconds>(
    fileTime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
  );
  return systemTime.time_since_epoch().count();
}

static void writeBatch(const std::vector<ScanItem>& batch);
static void writeError(const std::string& kind, const fs::path& path, const std::string& message);
static void writeDirectorySnapshot(const fs::path& path, std::int64_t mtimeMs, const std::vector<SnapshotEntry>& entries);

#ifdef _WIN32
static std::int64_t fileTimeToUnixMs(const FILETIME& fileTime) {
  ULARGE_INTEGER value;
  value.LowPart = fileTime.dwLowDateTime;
  value.HighPart = fileTime.dwHighDateTime;
  constexpr std::uint64_t windowsToUnixEpoch100Ns = 116444736000000000ULL;
  if (value.QuadPart < windowsToUnixEpoch100Ns) {
    return 0;
  }
  return static_cast<std::int64_t>((value.QuadPart - windowsToUnixEpoch100Ns) / 10000ULL);
}

static std::string extensionFromFileName(const std::string& fileName) {
  const std::size_t index = fileName.find_last_of('.');
  if (index == std::string::npos || index == fileName.size() - 1) {
    return "";
  }
  return asciiLower(fileName.substr(index));
}

static std::optional<WIN32_FILE_ATTRIBUTE_DATA> getFileAttributes(const std::wstring& path) {
  WIN32_FILE_ATTRIBUTE_DATA data;
  if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data) == 0) {
    return std::nullopt;
  }
  return data;
}

static std::wstring appendChildPath(const std::wstring& directory, const std::wstring& childName) {
  if (directory.empty() || directory.back() == L'\\' || directory.back() == L'/') {
    return directory + childName;
  }
  return directory + L"\\" + childName;
}

static void scanWindowsDirectory(
  const std::wstring& directory,
  const ScanRequest& request,
  std::vector<std::wstring>& directories,
  std::vector<ScanItem>& batch,
  std::uint64_t& directoryCount,
  std::uint64_t& fileCount
) {
  directoryCount += 1;
  const auto directoryAttributes = getFileAttributes(directory);
  std::vector<SnapshotEntry> snapshotEntries;
  const std::wstring searchPath = appendChildPath(directory, L"*");

  WIN32_FIND_DATAW data;
  HANDLE handle = FindFirstFileW(searchPath.c_str(), &data);
  if (handle == INVALID_HANDLE_VALUE) {
    writeError("directory", fs::path(directory), "FindFirstFileW failed: " + win32ErrorMessage(GetLastError()));
    return;
  }

  do {
    const std::wstring name(data.cFileName);
    if (name == L"." || name == L"..") {
      continue;
    }

    const bool isDirectory = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    const bool isReparsePoint = (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
    const std::wstring childPath = appendChildPath(directory, name);
    const std::string nameUtf8 = wideToUtf8(name);

    if (isDirectory) {
      if (!isReparsePoint) {
        directories.push_back(childPath);
        snapshotEntries.push_back({ nameUtf8, "directory" });
      }
      continue;
    }

    if (isReparsePoint) {
      continue;
    }

    const std::string extension = extensionFromFileName(nameUtf8);
    if (std::find(request.extensions.begin(), request.extensions.end(), extension) == request.extensions.end()) {
      continue;
    }

    snapshotEntries.push_back({ nameUtf8, "file" });
    const std::uintmax_t sizeBytes =
      (static_cast<std::uintmax_t>(data.nFileSizeHigh) << 32U) | static_cast<std::uintmax_t>(data.nFileSizeLow);
    batch.push_back({ wideToUtf8(childPath), sizeBytes, fileTimeToUnixMs(data.ftLastWriteTime) });
    fileCount += 1;
    if (batch.size() >= request.batchSize) {
      writeBatch(batch);
      batch.clear();
    }
  } while (FindNextFileW(handle, &data) != 0);

  FindClose(handle);
  if (directoryAttributes) {
    writeDirectorySnapshot(fs::path(directory), fileTimeToUnixMs(directoryAttributes->ftLastWriteTime), snapshotEntries);
  }

  if (directoryCount % 20 == 0) {
    std::cout << "{\"type\":\"progress\",\"directories\":" << directoryCount << ",\"files\":" << fileCount << "}" << std::endl;
  }
}

static bool scanWindowsRoot(const ScanRequest& request) {
  const std::wstring root = utf8ToWide(request.root);
  const auto attributes = getFileAttributes(root);
  if (!attributes || (attributes->dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
    const std::string detail = attributes ? "root is not a directory" : win32ErrorMessage(GetLastError());
    writeError("directory", fs::path(root), detail);
    std::cout << "{\"type\":\"done\",\"files\":0,\"errors\":[]}" << std::endl;
    return true;
  }

  std::vector<std::wstring> directories;
  directories.push_back(root);
  std::vector<ScanItem> batch;
  batch.reserve(request.batchSize);
  std::uint64_t directoryCount = 0;
  std::uint64_t fileCount = 0;

  while (!directories.empty()) {
    const std::wstring directory = directories.back();
    directories.pop_back();
    scanWindowsDirectory(directory, request, directories, batch, directoryCount, fileCount);
  }

  writeBatch(batch);
  std::cout << "{\"type\":\"done\",\"files\":" << fileCount << ",\"errors\":[]}" << std::endl;
  return true;
}
#endif

static void writeBatch(const std::vector<ScanItem>& batch) {
  if (batch.empty()) {
    return;
  }

  std::cout << "{\"type\":\"batch\",\"items\":[";
  for (std::size_t index = 0; index < batch.size(); index += 1) {
    const auto& item = batch[index];
    if (index > 0) {
      std::cout << ',';
    }
    std::cout
      << "{\"path\":\"" << jsonEscape(item.path)
      << "\",\"sizeBytes\":" << item.sizeBytes
      << ",\"mtimeMs\":" << item.mtimeMs
      << '}';
  }
  std::cout << "]}" << std::endl;
}

static void writeError(const std::string& kind, const fs::path& path, const std::string& message) {
  std::cout
    << "{\"type\":\"error\",\"kind\":\"" << jsonEscape(kind)
    << "\",\"path\":\"" << jsonEscape(pathToUtf8(path))
    << "\",\"message\":\"" << jsonEscape(message)
    << "\"}" << std::endl;
}

static void writeDirectorySnapshot(const fs::path& path, std::int64_t mtimeMs, const std::vector<SnapshotEntry>& entries) {
  std::cout
    << "{\"type\":\"directorySnapshot\",\"path\":\"" << jsonEscape(pathToUtf8(path))
    << "\",\"mtimeMs\":" << mtimeMs
    << ",\"entries\":[";
  for (std::size_t index = 0; index < entries.size(); index += 1) {
    const auto& entry = entries[index];
    if (index > 0) {
      std::cout << ',';
    }
    std::cout
      << "{\"name\":\"" << jsonEscape(entry.name)
      << "\",\"kind\":\"" << jsonEscape(entry.kind)
      << "\"}";
  }
  std::cout << "]}" << std::endl;
}

static ScanRequest parseRequest(const std::string& input) {
  ScanRequest request;
  request.root = parseStringField(input, "root").value_or("");
  request.extensions = parseStringArrayField(input, "extensions");
  request.batchSize = std::max<std::size_t>(1, std::min<std::size_t>(1024, parseSizeField(input, "batchSize", 256)));
  for (auto& extension : request.extensions) {
    extension = asciiLower(extension);
  }
  return request;
}

static std::string parseRequestType(const std::string& input) {
  return parseStringField(input, "type").value_or("scan");
}

static void parseFlacStreamInfo(const std::vector<unsigned char>& block, NativeMetadataResult& result) {
  if (block.size() < 18) {
    return;
  }

  const std::uint64_t packed = readBe64(block.data() + 10);
  const int sampleRate = static_cast<int>((packed >> 44U) & 0xfffffU);
  const int bitDepth = static_cast<int>(((packed >> 36U) & 0x1fU) + 1U);
  const std::uint64_t totalSamples = packed & 0xfffffffffULL;
  if (sampleRate > 0) {
    result.sampleRate = sampleRate;
    result.sources["sampleRate"] = "technical";
    if (totalSamples > 0) {
      result.duration = static_cast<double>(totalSamples) / static_cast<double>(sampleRate);
      result.sources["duration"] = "technical";
    }
  }
  if (bitDepth > 0) {
    result.bitDepth = bitDepth;
    result.sources["bitDepth"] = "technical";
  }
}

static void applyVorbisTags(
  const std::map<std::string, std::vector<std::string>>& tags,
  const std::string& filePath,
  NativeMetadataResult& result
);

static void parseWaveInfoList(const std::vector<unsigned char>& block, std::map<std::string, std::vector<std::string>>& tags) {
  if (block.size() < 4 || std::string(reinterpret_cast<const char*>(block.data()), 4) != "INFO") {
    return;
  }

  for (std::size_t offset = 4; offset + 8 <= block.size();) {
    const std::string id(reinterpret_cast<const char*>(block.data() + offset), 4);
    const std::uint32_t size = readLe32(block.data() + offset + 4);
    offset += 8;
    if (size > block.size() - offset) {
      break;
    }

    addRiffInfoTag(tags, id, cleanChunkText(block.data() + offset, size));
    offset += size + (size % 2U);
  }
}

static std::optional<NativeMetadataResult> readWaveMetadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  unsigned char header[12] = {};
  if (!readExact(stream, header, sizeof(header))) {
    unsupportedReason = "native metadata reader could not read WAV header";
    return std::nullopt;
  }
  const std::string riffId(reinterpret_cast<const char*>(header), 4);
  const std::string waveId(reinterpret_cast<const char*>(header + 8), 4);
  if ((riffId != "RIFF" && riffId != "RF64") || waveId != "WAVE") {
    unsupportedReason = "native metadata reader currently supports RIFF/RF64 WAVE only";
    return std::nullopt;
  }

  NativeMetadataResult result;
  initializeTechnicalSources(result, "WAV", "filename_fallback");
  std::map<std::string, std::vector<std::string>> tags;
  std::uint16_t audioFormat = 0;
  std::uint16_t bitsPerSample = 0;
  std::uint32_t sampleRate = 0;
  std::uint32_t byteRate = 0;
  std::uint64_t dataBytes = 0;
  bool sawFmt = false;

  constexpr std::uint32_t maxSmallWaveChunkBytes = 2U * 1024U * 1024U;
  for (int chunkIndex = 0; chunkIndex < 100000; chunkIndex += 1) {
    unsigned char chunkHeader[8] = {};
    if (!readExact(stream, chunkHeader, sizeof(chunkHeader))) {
      break;
    }
    const std::string id(reinterpret_cast<const char*>(chunkHeader), 4);
    const std::uint32_t size = readLe32(chunkHeader + 4);

    if (id == "fmt " && size <= maxSmallWaveChunkBytes) {
      std::vector<unsigned char> chunk(size);
      if (!readExact(stream, chunk)) {
        break;
      }
      if (chunk.size() >= 16) {
        sawFmt = true;
        audioFormat = readLe16(chunk.data());
        sampleRate = readLe32(chunk.data() + 4);
        byteRate = readLe32(chunk.data() + 8);
        bitsPerSample = readLe16(chunk.data() + 14);
      }
    } else if (id == "LIST" && size <= maxSmallWaveChunkBytes) {
      std::vector<unsigned char> chunk(size);
      if (!readExact(stream, chunk)) {
        break;
      }
      parseWaveInfoList(chunk, tags);
    } else {
      if (id == "data") {
        dataBytes = size;
      }
      stream.seekg(static_cast<std::streamoff>(size), std::ios::cur);
      if (!stream.good()) {
        break;
      }
    }

    if ((size % 2U) != 0) {
      stream.seekg(1, std::ios::cur);
      if (!stream.good()) {
        break;
      }
    }
  }

  if (!sawFmt || sampleRate == 0) {
    unsupportedReason = "native metadata reader found no usable WAV fmt chunk";
    return std::nullopt;
  }

  if (audioFormat == 1) {
    result.codec = "PCM";
  } else if (audioFormat == 3) {
    result.codec = "IEEE_FLOAT";
  } else if (audioFormat == 0xfffeU) {
    result.codec = "WAVE_FORMAT_EXTENSIBLE";
  }
  result.sources["codec"] = "technical";
  result.sampleRate = static_cast<int>(sampleRate);
  result.sources["sampleRate"] = "technical";
  if (bitsPerSample > 0) {
    result.bitDepth = static_cast<int>(bitsPerSample);
    result.sources["bitDepth"] = "technical";
  }
  if (byteRate > 0) {
    result.bitrate = static_cast<int>(byteRate * 8U);
    result.sources["bitrate"] = "technical";
    if (dataBytes > 0 && dataBytes < 0xffffffffULL) {
      result.duration = static_cast<double>(dataBytes) / static_cast<double>(byteRate);
      result.sources["duration"] = "technical";
    }
  }

  applyVorbisTags(tags, filePath, result);
  result.hasVorbisComments = !tags.empty();
  return result;
}

static double parseAiffExtendedSampleRate(const unsigned char* bytes) {
  const std::uint16_t exponent = static_cast<std::uint16_t>(((bytes[0] & 0x7fU) << 8U) | bytes[1]);
  const std::uint64_t mantissa = readBe64(bytes + 2);
  if (exponent == 0 || mantissa == 0) {
    return 0;
  }
  const double value = std::ldexp(static_cast<double>(mantissa), static_cast<int>(exponent) - 16383 - 63);
  return std::isfinite(value) && value > 0 ? value : 0;
}

static std::optional<NativeMetadataResult> readAiffMetadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  unsigned char header[12] = {};
  if (!readExact(stream, header, sizeof(header))) {
    unsupportedReason = "native metadata reader could not read AIFF header";
    return std::nullopt;
  }
  if (std::string(reinterpret_cast<const char*>(header), 4) != "FORM") {
    unsupportedReason = "native metadata reader currently supports FORM AIFF/AIFC only";
    return std::nullopt;
  }
  const std::string formType(reinterpret_cast<const char*>(header + 8), 4);
  if (formType != "AIFF" && formType != "AIFC") {
    unsupportedReason = "native metadata reader currently supports AIFF/AIFC only";
    return std::nullopt;
  }

  NativeMetadataResult result;
  initializeTechnicalSources(result, formType == "AIFC" ? "AIFC" : "AIFF", "filename_fallback");
  std::map<std::string, std::vector<std::string>> tags;
  bool sawComm = false;
  std::uint16_t sampleSize = 0;
  std::uint32_t sampleFrames = 0;
  double sampleRate = 0;

  constexpr std::uint32_t maxSmallAiffChunkBytes = 2U * 1024U * 1024U;
  for (int chunkIndex = 0; chunkIndex < 100000; chunkIndex += 1) {
    unsigned char chunkHeader[8] = {};
    if (!readExact(stream, chunkHeader, sizeof(chunkHeader))) {
      break;
    }
    const std::string id(reinterpret_cast<const char*>(chunkHeader), 4);
    const std::uint32_t size = readBe32(chunkHeader + 4);

    if (id == "COMM" && size <= maxSmallAiffChunkBytes) {
      std::vector<unsigned char> chunk(size);
      if (!readExact(stream, chunk)) {
        break;
      }
      if (chunk.size() >= 18) {
        sawComm = true;
        sampleFrames = readBe32(chunk.data() + 2);
        sampleSize = readBe16(chunk.data() + 6);
        sampleRate = parseAiffExtendedSampleRate(chunk.data() + 8);
        if (formType == "AIFC" && chunk.size() >= 22) {
          const std::string compression(reinterpret_cast<const char*>(chunk.data() + 18), 4);
          if (compression == "NONE" || compression == "sowt") {
            result.codec = "PCM";
          } else if (compression == "fl32" || compression == "fl64") {
            result.codec = "IEEE_FLOAT";
          } else {
            result.codec = compression;
          }
        } else {
          result.codec = "PCM";
        }
        result.sources["codec"] = "technical";
      }
    } else if ((id == "NAME" || id == "AUTH" || id == "ANNO") && size <= maxSmallAiffChunkBytes) {
      std::vector<unsigned char> chunk(size);
      if (!readExact(stream, chunk)) {
        break;
      }
      if (id == "NAME") {
        addTextTag(tags, "title", cleanChunkText(chunk.data(), chunk.size()));
      } else if (id == "AUTH") {
        addTextTag(tags, "artist", cleanChunkText(chunk.data(), chunk.size()));
      } else if (id == "ANNO") {
        addTextTag(tags, "album", cleanChunkText(chunk.data(), chunk.size()));
      }
    } else {
      stream.seekg(static_cast<std::streamoff>(size), std::ios::cur);
      if (!stream.good()) {
        break;
      }
    }

    if ((size % 2U) != 0) {
      stream.seekg(1, std::ios::cur);
      if (!stream.good()) {
        break;
      }
    }
  }

  if (!sawComm || !(sampleRate > 0)) {
    unsupportedReason = "native metadata reader found no usable AIFF COMM chunk";
    return std::nullopt;
  }

  result.sampleRate = static_cast<int>(std::lround(sampleRate));
  result.sources["sampleRate"] = "technical";
  if (sampleSize > 0) {
    result.bitDepth = static_cast<int>(sampleSize);
    result.sources["bitDepth"] = "technical";
  }
  if (sampleFrames > 0) {
    result.duration = static_cast<double>(sampleFrames) / sampleRate;
    result.sources["duration"] = "technical";
  }

  applyVorbisTags(tags, filePath, result);
  result.hasVorbisComments = !tags.empty();
  return result;
}

static std::map<std::string, std::vector<std::string>> parseVorbisCommentBlock(const std::vector<unsigned char>& block) {
  std::map<std::string, std::vector<std::string>> tags;
  std::size_t offset = 0;
  if (block.size() < 8) {
    return tags;
  }

  const std::uint32_t vendorLength = readLe32(block.data() + offset);
  offset += 4;
  if (vendorLength > block.size() - offset) {
    return tags;
  }
  offset += vendorLength;
  if (block.size() - offset < 4) {
    return tags;
  }

  const std::uint32_t commentCount = readLe32(block.data() + offset);
  offset += 4;
  constexpr std::uint32_t maxCommentCount = 512;
  if (commentCount > maxCommentCount) {
    return tags;
  }

  for (std::uint32_t index = 0; index < commentCount; index += 1) {
    if (block.size() - offset < 4) {
      break;
    }
    const std::uint32_t length = readLe32(block.data() + offset);
    offset += 4;
    if (length > block.size() - offset) {
      break;
    }

    const std::string raw(reinterpret_cast<const char*>(block.data() + offset), length);
    offset += length;
    const std::size_t equalsIndex = raw.find('=');
    if (equalsIndex == std::string::npos || equalsIndex == 0) {
      continue;
    }

    std::string key = asciiLower(raw.substr(0, equalsIndex));
    auto value = cleanMetadataText(raw.substr(equalsIndex + 1));
    if (!value) {
      continue;
    }
    tags[key].push_back(*value);
  }

  return tags;
}

static std::string fileStemFromPath(const std::string& filePath) {
  const fs::path path = pathFromUtf8(filePath);
  const std::string stem = pathToUtf8(path.stem());
  return stem.empty() ? "Untitled" : stem;
}

static void applyVorbisTags(
  const std::map<std::string, std::vector<std::string>>& tags,
  const std::string& filePath,
  NativeMetadataResult& result
) {
  const std::string title = firstTagValue(tags, "title");
  const std::string artist = joinedTagValue(tags, "artist");
  const std::string album = firstTagValue(tags, "album");
  const std::string albumArtist = firstTagValue(tags, "albumartist");
  const std::string genre = joinedTagValue(tags, "genre");
  const std::string trackNumber = firstTagValue(tags, "tracknumber");
  const std::string discNumber = firstTagValue(tags, "discnumber");
  const std::string date = firstTagValue(tags, "date").empty() ? firstTagValue(tags, "year") : firstTagValue(tags, "date");

  result.title = title.empty() ? fileStemFromPath(filePath) : title;
  result.sources["title"] = title.empty() ? "filename_fallback" : "embedded";

  result.artist = artist.empty() ? "Unknown Artist" : artist;
  result.sources["artist"] = artist.empty() ? "unknown" : "embedded";

  result.album = album;
  result.sources["album"] = album.empty() ? "unknown" : "embedded";

  result.albumArtist = albumArtist.empty() ? result.artist : albumArtist;
  result.sources["albumArtist"] = albumArtist.empty() ? "artist_fallback" : "embedded";

  if (!genre.empty()) {
    result.genre = genre;
    result.sources["genre"] = "embedded";
  } else {
    result.sources["genre"] = "unknown";
  }

  result.trackNo = parseLeadingPositiveInt(trackNumber);
  result.sources["trackNo"] = result.trackNo ? "embedded" : "unknown";
  result.discNo = parseLeadingPositiveInt(discNumber);
  result.sources["discNo"] = result.discNo ? "embedded" : "unknown";
  result.year = parseYear(date);
  result.sources["year"] = result.year ? "embedded" : "unknown";
}

static bool packetStartsWith(const std::vector<unsigned char>& packet, const char* marker, std::size_t markerSize, std::size_t offset = 0) {
  if (packet.size() < offset + markerSize) {
    return false;
  }
  for (std::size_t index = 0; index < markerSize; index += 1) {
    if (packet[offset + index] != static_cast<unsigned char>(marker[index])) {
      return false;
    }
  }
  return true;
}

static std::map<std::string, std::vector<std::string>> parseOggCommentPacket(const std::vector<unsigned char>& packet, std::size_t prefixBytes) {
  if (packet.size() <= prefixBytes) {
    return {};
  }
  return parseVorbisCommentBlock(std::vector<unsigned char>(packet.begin() + static_cast<std::ptrdiff_t>(prefixBytes), packet.end()));
}

static std::optional<NativeMetadataResult> readOggMetadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  NativeMetadataResult result;
  initializeTechnicalSources(result, "Ogg", "filename_fallback");
  std::map<std::string, std::vector<std::string>> tags;
  std::vector<unsigned char> currentPacket;
  std::vector<std::vector<unsigned char>> packets;
  std::uint64_t lastGranule = 0;
  bool sawGranule = false;
  bool parsedIdentification = false;
  bool parsedComments = false;
  std::string codec;
  int sampleRate = 0;
  int bitrate = 0;
  int opusPreSkip = 0;

  constexpr std::size_t maxOggMetadataPacketBytes = 2U * 1024U * 1024U;
  constexpr std::uint64_t maxOggScanBytes = 256ULL * 1024ULL * 1024ULL;
  std::uint64_t scannedBytes = 0;

  while (scannedBytes < maxOggScanBytes) {
    unsigned char header[27] = {};
    if (!readExact(stream, header, sizeof(header))) {
      break;
    }
    scannedBytes += sizeof(header);
    if (std::string(reinterpret_cast<const char*>(header), 4) != "OggS") {
      unsupportedReason = "native metadata reader found invalid Ogg page";
      return std::nullopt;
    }

    const std::uint64_t granule = readLe64(header + 6);
    if (granule != UINT64_MAX) {
      lastGranule = granule;
      sawGranule = true;
    }
    const std::size_t segmentCount = header[26];
    std::vector<unsigned char> lacing(segmentCount);
    if (!readExact(stream, lacing)) {
      break;
    }
    scannedBytes += segmentCount;
    std::size_t bodySize = 0;
    for (unsigned char segment : lacing) {
      bodySize += segment;
    }

    if (parsedIdentification && parsedComments) {
      stream.seekg(static_cast<std::streamoff>(bodySize), std::ios::cur);
      if (!stream.good()) {
        break;
      }
      scannedBytes += bodySize;
      continue;
    }

    std::vector<unsigned char> body(bodySize);
    if (!readExact(stream, body)) {
      break;
    }
    scannedBytes += bodySize;

    std::size_t bodyOffset = 0;
    for (unsigned char segment : lacing) {
      if (bodyOffset + segment > body.size()) {
        break;
      }
      if (currentPacket.size() + segment > maxOggMetadataPacketBytes) {
        unsupportedReason = "native metadata reader skipped oversized Ogg metadata packet";
        return std::nullopt;
      }
      currentPacket.insert(currentPacket.end(), body.begin() + static_cast<std::ptrdiff_t>(bodyOffset), body.begin() + static_cast<std::ptrdiff_t>(bodyOffset + segment));
      bodyOffset += segment;
      if (segment < 255) {
        packets.push_back(currentPacket);
        currentPacket.clear();
      }
    }

    for (const auto& packet : packets) {
      if (!parsedIdentification && packetStartsWith(packet, "vorbis", 6, 1) && packet.size() >= 30 && packet[0] == 0x01) {
        codec = "Vorbis";
        sampleRate = static_cast<int>(readLe32(packet.data() + 12));
        const std::uint32_t nominalBitrate = readLe32(packet.data() + 20);
        if (nominalBitrate > 0 && nominalBitrate < 10000000U) {
          bitrate = static_cast<int>(nominalBitrate);
        }
        parsedIdentification = true;
      } else if (!parsedIdentification && packetStartsWith(packet, "OpusHead", 8) && packet.size() >= 19) {
        codec = "Opus";
        sampleRate = 48000;
        opusPreSkip = static_cast<int>(readLe16(packet.data() + 10));
        parsedIdentification = true;
      }

      if (!parsedComments && packetStartsWith(packet, "vorbis", 6, 1) && packet.size() > 7 && packet[0] == 0x03) {
        tags = parseOggCommentPacket(packet, 7);
        parsedComments = !tags.empty();
      } else if (!parsedComments && packetStartsWith(packet, "OpusTags", 8)) {
        tags = parseOggCommentPacket(packet, 8);
        parsedComments = !tags.empty();
      }
    }
    packets.clear();
  }

  if (!parsedIdentification || codec.empty()) {
    unsupportedReason = "native metadata reader found no supported Ogg identification packet";
    return std::nullopt;
  }

  result.codec = codec;
  result.sources["codec"] = "technical";
  if (sampleRate > 0) {
    result.sampleRate = sampleRate;
    result.sources["sampleRate"] = "technical";
  }
  if (bitrate > 0) {
    result.bitrate = bitrate;
    result.sources["bitrate"] = "technical";
  }
  if (sawGranule && sampleRate > 0 && lastGranule > 0) {
    const std::uint64_t adjustedGranule = codec == "Opus" && lastGranule > static_cast<std::uint64_t>(opusPreSkip)
      ? lastGranule - static_cast<std::uint64_t>(opusPreSkip)
      : lastGranule;
    result.duration = static_cast<double>(adjustedGranule) / static_cast<double>(sampleRate);
    result.sources["duration"] = "technical";
  }

  applyVorbisTags(tags, filePath, result);
  result.hasVorbisComments = !tags.empty();
  return result;
}

static std::optional<NativeMetadataResult> readFlacMetadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  unsigned char marker[4] = {};
  if (!readExact(stream, marker, sizeof(marker)) || std::string(reinterpret_cast<char*>(marker), sizeof(marker)) != "fLaC") {
    unsupportedReason = "native metadata reader currently supports FLAC only";
    return std::nullopt;
  }

  NativeMetadataResult result;
  result.sources["duration"] = "unknown";
  result.sources["codec"] = "technical";
  result.sources["sampleRate"] = "unknown";
  result.sources["bitDepth"] = "unknown";
  result.sources["bitrate"] = "unknown";
  result.sources["bpm"] = "unknown";
  result.sources["replayGainTrackGainDb"] = "unknown";
  result.sources["replayGainAlbumGainDb"] = "unknown";
  result.sources["replayGainTrackPeak"] = "unknown";
  result.sources["replayGainAlbumPeak"] = "unknown";
  result.sources["replayGainIntegratedLufs"] = "unknown";

  constexpr std::uint32_t maxNativeMetadataBlockBytes = 2U * 1024U * 1024U;
  for (int blockIndex = 0; blockIndex < 256; blockIndex += 1) {
    unsigned char header[4] = {};
    if (!readExact(stream, header, sizeof(header))) {
      break;
    }

    const bool isLast = (header[0] & 0x80U) != 0;
    const int blockType = header[0] & 0x7fU;
    const std::uint32_t length = readBe24(header + 1);
    if (length > maxNativeMetadataBlockBytes) {
      unsupportedReason = "native metadata reader skipped oversized FLAC metadata block";
      return std::nullopt;
    }

    if (blockType == 0 || blockType == 4) {
      std::vector<unsigned char> block(length);
      if (!readExact(stream, block)) {
        break;
      }
      if (blockType == 0) {
        parseFlacStreamInfo(block, result);
      } else {
        const auto tags = parseVorbisCommentBlock(block);
        if (!tags.empty()) {
          result.hasVorbisComments = true;
          applyVorbisTags(tags, filePath, result);
        }
      }
    } else {
      stream.seekg(static_cast<std::streamoff>(length), std::ios::cur);
      if (!stream.good()) {
        break;
      }
    }

    if (isLast) {
      break;
    }
  }

  if (!result.hasVorbisComments) {
    unsupportedReason = "native metadata reader found no FLAC Vorbis comments";
    return std::nullopt;
  }

  if (result.title.empty()) {
    result.title = fileStemFromPath(filePath);
    result.sources["title"] = "filename_fallback";
  }
  if (result.artist.empty()) {
    result.artist = "Unknown Artist";
    result.sources["artist"] = "unknown";
  }
  if (result.albumArtist.empty()) {
    result.albumArtist = result.artist;
    result.sources["albumArtist"] = "artist_fallback";
  }

  return result;
}

static bool isValidId3FrameId(const unsigned char* bytes) {
  for (int index = 0; index < 4; index += 1) {
    const unsigned char ch = bytes[index];
    if (!((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))) {
      return false;
    }
  }
  return true;
}

static std::optional<Mp3StreamInfo> parseMp3FrameHeader(std::uint32_t header) {
  if ((header & 0xffe00000U) != 0xffe00000U) {
    return std::nullopt;
  }

  const int versionBits = static_cast<int>((header >> 19U) & 0x3U);
  const int layerBits = static_cast<int>((header >> 17U) & 0x3U);
  const int bitrateIndex = static_cast<int>((header >> 12U) & 0xfU);
  const int sampleRateIndex = static_cast<int>((header >> 10U) & 0x3U);

  if (versionBits == 1 || layerBits != 1 || bitrateIndex == 0 || bitrateIndex == 15 || sampleRateIndex == 3) {
    return std::nullopt;
  }

  static constexpr int mpeg1Layer3BitratesKbps[] = {
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  };
  static constexpr int mpeg2Layer3BitratesKbps[] = {
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
  };
  static constexpr int mpeg1SampleRates[] = { 44100, 48000, 32000 };

  int sampleRate = mpeg1SampleRates[sampleRateIndex];
  if (versionBits == 2) {
    sampleRate /= 2;
  } else if (versionBits == 0) {
    sampleRate /= 4;
  }

  const bool isMpeg1 = versionBits == 3;
  const int bitrateKbps = isMpeg1 ? mpeg1Layer3BitratesKbps[bitrateIndex] : mpeg2Layer3BitratesKbps[bitrateIndex];
  if (bitrateKbps <= 0 || sampleRate <= 0) {
    return std::nullopt;
  }

  Mp3StreamInfo info;
  info.sampleRate = sampleRate;
  info.bitrate = bitrateKbps * 1000;
  return info;
}

static std::optional<std::uint32_t> readMp3FrameCountFromXingOrInfo(
  std::ifstream& stream,
  std::uintmax_t fileSize,
  std::uintmax_t frameStart,
  std::uint32_t header
) {
  const int versionBits = static_cast<int>((header >> 19U) & 0x3U);
  const int channelMode = static_cast<int>((header >> 6U) & 0x3U);
  const bool isMpeg1 = versionBits == 3;
  const bool isMono = channelMode == 3;
  const std::uintmax_t sideInfoBytes = isMpeg1 ? (isMono ? 17U : 32U) : (isMono ? 9U : 17U);
  const std::uintmax_t xingOffset = frameStart + 4U + sideInfoBytes;
  if (xingOffset + 16U > fileSize) {
    return std::nullopt;
  }

  stream.clear();
  stream.seekg(static_cast<std::streamoff>(xingOffset), std::ios::beg);
  unsigned char headerBytes[16] = {};
  if (!readExact(stream, headerBytes, sizeof(headerBytes))) {
    return std::nullopt;
  }

  const std::string marker(reinterpret_cast<const char*>(headerBytes), 4);
  if (marker != "Xing" && marker != "Info") {
    return std::nullopt;
  }

  const std::uint32_t flags = readBe32(headerBytes + 4);
  if ((flags & 0x1U) == 0) {
    return std::nullopt;
  }

  const std::uint32_t frames = readBe32(headerBytes + 8);
  return frames > 0 ? std::optional<std::uint32_t>(frames) : std::nullopt;
}

static std::optional<std::uint32_t> readMp3FrameCountFromVbri(std::ifstream& stream, std::uintmax_t fileSize, std::uintmax_t frameStart) {
  const std::uintmax_t vbriOffset = frameStart + 4U + 32U;
  if (vbriOffset + 18U > fileSize) {
    return std::nullopt;
  }

  stream.clear();
  stream.seekg(static_cast<std::streamoff>(vbriOffset), std::ios::beg);
  unsigned char headerBytes[18] = {};
  if (!readExact(stream, headerBytes, sizeof(headerBytes))) {
    return std::nullopt;
  }

  const std::string marker(reinterpret_cast<const char*>(headerBytes), 4);
  if (marker != "VBRI") {
    return std::nullopt;
  }

  const std::uint32_t frames = readBe32(headerBytes + 14);
  return frames > 0 ? std::optional<std::uint32_t>(frames) : std::nullopt;
}

static std::optional<Mp3StreamInfo> readMp3StreamInfo(
  std::ifstream& stream,
  const std::string& filePath,
  std::uintmax_t audioStart,
  std::string& unsupportedReason
) {
  std::error_code errorCode;
  const std::uintmax_t fileSize = fs::file_size(pathFromUtf8(filePath), errorCode);
  if (errorCode || fileSize <= audioStart + 4U) {
    unsupportedReason = "native metadata reader could not determine MP3 audio size";
    return std::nullopt;
  }

  stream.clear();
  stream.seekg(static_cast<std::streamoff>(audioStart), std::ios::beg);

  unsigned char frameHeaderBytes[4] = {};
  std::uintmax_t frameStart = audioStart;
  bool foundFrame = false;
  constexpr std::uintmax_t maxMp3FrameSyncSearchBytes = 4096;
  for (std::uintmax_t scanned = 0; scanned <= maxMp3FrameSyncSearchBytes && frameStart + 4U <= fileSize; scanned += 1, frameStart += 1) {
    stream.clear();
    stream.seekg(static_cast<std::streamoff>(frameStart), std::ios::beg);
    if (!readExact(stream, frameHeaderBytes, sizeof(frameHeaderBytes))) {
      break;
    }
    const std::uint32_t header = readBe32(frameHeaderBytes);
    if (parseMp3FrameHeader(header)) {
      foundFrame = true;
      break;
    }
  }

  if (!foundFrame) {
    unsupportedReason = "native metadata reader could not find MP3 audio frame";
    return std::nullopt;
  }

  const std::uint32_t frameHeader = readBe32(frameHeaderBytes);
  auto info = parseMp3FrameHeader(frameHeader);
  if (!info) {
    unsupportedReason = "native metadata reader could not parse MP3 frame header";
    return std::nullopt;
  }

  const int versionBits = static_cast<int>((frameHeader >> 19U) & 0x3U);
  const int samplesPerFrame = versionBits == 3 ? 1152 : 576;
  const auto xingFrames = readMp3FrameCountFromXingOrInfo(stream, fileSize, frameStart, frameHeader);
  const auto vbriFrames = xingFrames ? std::nullopt : readMp3FrameCountFromVbri(stream, fileSize, frameStart);
  if (xingFrames || vbriFrames) {
    const std::uint32_t frames = xingFrames.value_or(vbriFrames.value_or(0));
    info->duration = static_cast<double>(frames) * static_cast<double>(samplesPerFrame) / static_cast<double>(info->sampleRate);
  } else {
    const std::uintmax_t audioBytes = fileSize - frameStart;
    info->duration = static_cast<double>(audioBytes) * 8.0 / static_cast<double>(info->bitrate);
  }

  if (!(info->duration > 0.001)) {
    unsupportedReason = "native metadata reader could not determine MP3 duration";
    return std::nullopt;
  }

  return info;
}

static std::optional<NativeMetadataResult> readMp3Id3Metadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  unsigned char header[10] = {};
  if (!readExact(stream, header, sizeof(header)) || header[0] != 'I' || header[1] != 'D' || header[2] != '3') {
    unsupportedReason = "native metadata reader found no ID3v2 tag";
    return std::nullopt;
  }

  const int majorVersion = header[3];
  if (majorVersion != 3 && majorVersion != 4) {
    unsupportedReason = "native metadata reader currently supports ID3v2.3/v2.4 only";
    return std::nullopt;
  }

  const unsigned char flags = header[5];
  if ((flags & 0x80U) != 0 || (flags & 0x40U) != 0) {
    unsupportedReason = "native metadata reader skipped complex ID3v2 tag flags";
    return std::nullopt;
  }

  const auto tagSize = readSynchsafe32(header + 6);
  constexpr std::uint32_t maxNativeId3TagBytes = 4U * 1024U * 1024U;
  if (!tagSize || *tagSize == 0 || *tagSize > maxNativeId3TagBytes) {
    unsupportedReason = "native metadata reader skipped invalid or oversized ID3v2 tag";
    return std::nullopt;
  }

  std::vector<unsigned char> tag(*tagSize);
  if (!readExact(stream, tag)) {
    unsupportedReason = "native metadata reader could not read ID3v2 tag";
    return std::nullopt;
  }

  const std::uintmax_t audioStart = 10U + static_cast<std::uintmax_t>(*tagSize) + (((flags & 0x10U) != 0) ? 10U : 0U);

  std::map<std::string, std::vector<std::string>> tags;
  for (std::size_t offset = 0; offset + 10 <= tag.size();) {
    if (tag[offset] == 0 && tag[offset + 1] == 0 && tag[offset + 2] == 0 && tag[offset + 3] == 0) {
      break;
    }
    if (!isValidId3FrameId(tag.data() + offset)) {
      break;
    }

    const std::string frameId(reinterpret_cast<const char*>(tag.data() + offset), 4);
    const auto frameSize = majorVersion == 4 ? readSynchsafe32(tag.data() + offset + 4) : std::optional<std::uint32_t>(readBe32(tag.data() + offset + 4));
    if (!frameSize || *frameSize == 0) {
      break;
    }
    if (offset + 10 + *frameSize > tag.size()) {
      break;
    }

    const unsigned char flagA = tag[offset + 8];
    const unsigned char flagB = tag[offset + 9];
    const bool complexFrame =
      (majorVersion == 3 && ((flagB & 0x80U) != 0 || (flagB & 0x40U) != 0 || (flagB & 0x20U) != 0)) ||
      (majorVersion == 4 && ((flagB & 0x08U) != 0 || (flagB & 0x04U) != 0 || (flagB & 0x02U) != 0 || (flagB & 0x01U) != 0));
    (void)flagA;

    if (!complexFrame) {
      std::vector<unsigned char> frame(tag.begin() + static_cast<std::ptrdiff_t>(offset + 10), tag.begin() + static_cast<std::ptrdiff_t>(offset + 10 + *frameSize));
      if (frameId == "TIT2") {
        addTextTag(tags, "title", decodeId3TextFrame(frame));
      } else if (frameId == "TPE1") {
        addTextTag(tags, "artist", decodeId3TextFrame(frame));
      } else if (frameId == "TALB") {
        addTextTag(tags, "album", decodeId3TextFrame(frame));
      } else if (frameId == "TPE2") {
        addTextTag(tags, "albumartist", decodeId3TextFrame(frame));
      } else if (frameId == "TRCK") {
        addTextTag(tags, "tracknumber", decodeId3TextFrame(frame));
      } else if (frameId == "TPOS") {
        addTextTag(tags, "discnumber", decodeId3TextFrame(frame));
      } else if (frameId == "TDRC" || frameId == "TYER") {
        addTextTag(tags, "date", decodeId3TextFrame(frame));
      } else if (frameId == "TCON") {
        addTextTag(tags, "genre", decodeId3TextFrame(frame));
      }
    }

    offset += 10 + *frameSize;
  }

  if (tags.empty()) {
    unsupportedReason = "native metadata reader found no supported ID3v2 text frames";
    return std::nullopt;
  }

  const auto streamInfo = readMp3StreamInfo(stream, filePath, audioStart, unsupportedReason);
  if (!streamInfo) {
    return std::nullopt;
  }

  NativeMetadataResult result;
  result.codec = "MP3";
  result.duration = streamInfo->duration;
  result.sampleRate = streamInfo->sampleRate;
  result.bitrate = streamInfo->bitrate;
  result.sources["duration"] = "technical";
  result.sources["codec"] = "technical";
  result.sources["sampleRate"] = "technical";
  result.sources["bitDepth"] = "unknown";
  result.sources["bitrate"] = "technical";
  result.sources["bpm"] = "unknown";
  result.sources["replayGainTrackGainDb"] = "unknown";
  result.sources["replayGainAlbumGainDb"] = "unknown";
  result.sources["replayGainTrackPeak"] = "unknown";
  result.sources["replayGainAlbumPeak"] = "unknown";
  result.sources["replayGainIntegratedLufs"] = "unknown";
  applyVorbisTags(tags, filePath, result);
  result.hasVorbisComments = true;
  return result;
}

struct Mp4Box {
  std::string type;
  std::size_t start = 0;
  std::size_t size = 0;
  std::size_t headerSize = 0;
};

static std::string mp4Type(const unsigned char* bytes) {
  return std::string(reinterpret_cast<const char*>(bytes), 4);
}

static std::string mp4CopyrightType(char a, char b, char c) {
  return std::string({ static_cast<char>(0xa9), a, b, c });
}

static std::vector<Mp4Box> parseMp4Boxes(const std::vector<unsigned char>& data, std::size_t start, std::size_t end) {
  std::vector<Mp4Box> boxes;
  std::size_t offset = start;
  while (offset + 8 <= end && offset + 8 <= data.size()) {
    const std::uint32_t smallSize = readBe32(data.data() + offset);
    const std::string type = mp4Type(data.data() + offset + 4);
    std::uint64_t boxSize = smallSize;
    std::size_t headerSize = 8;
    if (smallSize == 1) {
      if (offset + 16 > end || offset + 16 > data.size()) {
        break;
      }
      boxSize = readBe64(data.data() + offset + 8);
      headerSize = 16;
    } else if (smallSize == 0) {
      boxSize = end - offset;
    }

    if (boxSize < headerSize || boxSize > static_cast<std::uint64_t>(end - offset)) {
      break;
    }

    boxes.push_back({ type, offset, static_cast<std::size_t>(boxSize), headerSize });
    offset += static_cast<std::size_t>(boxSize);
  }
  return boxes;
}

static std::optional<Mp4Box> findMp4Box(
  const std::vector<unsigned char>& data,
  std::size_t start,
  std::size_t end,
  const std::string& type
) {
  for (const Mp4Box& box : parseMp4Boxes(data, start, end)) {
    if (box.type == type) {
      return box;
    }
  }
  return std::nullopt;
}

static std::optional<std::string> parseMp4TextDataAtom(const std::vector<unsigned char>& data, const Mp4Box& dataBox) {
  const std::size_t payloadStart = dataBox.start + dataBox.headerSize + 8;
  const std::size_t payloadEnd = dataBox.start + dataBox.size;
  if (payloadStart > payloadEnd || payloadEnd > data.size()) {
    return std::nullopt;
  }
  return cleanMetadataText(std::string(reinterpret_cast<const char*>(data.data() + payloadStart), payloadEnd - payloadStart));
}

static std::optional<int> parseMp4PairDataAtom(const std::vector<unsigned char>& data, const Mp4Box& dataBox) {
  const std::size_t payloadStart = dataBox.start + dataBox.headerSize + 8;
  const std::size_t payloadEnd = dataBox.start + dataBox.size;
  if (payloadStart + 4 > payloadEnd || payloadEnd > data.size()) {
    return std::nullopt;
  }
  if (payloadEnd - payloadStart >= 6) {
    const int value = readBe16(data.data() + payloadStart + 2);
    return value > 0 ? std::optional<int>(value) : std::nullopt;
  }
  const int value = readBe16(data.data() + payloadStart);
  return value > 0 ? std::optional<int>(value) : std::nullopt;
}

static void applyMp4IlstItem(
  const std::vector<unsigned char>& data,
  const Mp4Box& item,
  std::map<std::string, std::vector<std::string>>& tags
) {
  const std::size_t contentStart = item.start + item.headerSize;
  const std::size_t contentEnd = item.start + item.size;
  const auto dataBox = findMp4Box(data, contentStart, contentEnd, "data");
  if (!dataBox) {
    return;
  }

  if (item.type == mp4CopyrightType('n', 'a', 'm')) {
    addTextTag(tags, "title", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == mp4CopyrightType('A', 'R', 'T')) {
    addTextTag(tags, "artist", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == mp4CopyrightType('a', 'l', 'b')) {
    addTextTag(tags, "album", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == "aART") {
    addTextTag(tags, "albumartist", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == mp4CopyrightType('d', 'a', 'y')) {
    addTextTag(tags, "date", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == mp4CopyrightType('g', 'e', 'n')) {
    addTextTag(tags, "genre", parseMp4TextDataAtom(data, *dataBox));
  } else if (item.type == "trkn") {
    const auto value = parseMp4PairDataAtom(data, *dataBox);
    if (value) {
      tags["tracknumber"].push_back(std::to_string(*value));
    }
  } else if (item.type == "disk") {
    const auto value = parseMp4PairDataAtom(data, *dataBox);
    if (value) {
      tags["discnumber"].push_back(std::to_string(*value));
    }
  }
}

static void parseMp4Mvhd(const std::vector<unsigned char>& data, const Mp4Box& mvhd, NativeMetadataResult& result) {
  const std::size_t contentStart = mvhd.start + mvhd.headerSize;
  const std::size_t contentEnd = mvhd.start + mvhd.size;
  if (contentStart + 4 > contentEnd || contentEnd > data.size()) {
    return;
  }

  const unsigned char version = data[contentStart];
  std::size_t offset = contentStart + 4;
  if (version == 1) {
    if (offset + 28 > contentEnd) {
      return;
    }
    offset += 16;
    const std::uint32_t timescale = readBe32(data.data() + offset);
    const std::uint64_t duration = readBe64(data.data() + offset + 4);
    if (timescale > 0 && duration > 0) {
      result.duration = static_cast<double>(duration) / static_cast<double>(timescale);
      result.sources["duration"] = "technical";
    }
  } else {
    if (offset + 16 > contentEnd) {
      return;
    }
    offset += 8;
    const std::uint32_t timescale = readBe32(data.data() + offset);
    const std::uint32_t duration = readBe32(data.data() + offset + 4);
    if (timescale > 0 && duration > 0) {
      result.duration = static_cast<double>(duration) / static_cast<double>(timescale);
      result.sources["duration"] = "technical";
    }
  }
}

static std::optional<NativeMetadataResult> readMp4Metadata(const std::string& filePath, std::string& unsupportedReason) {
  std::ifstream stream(pathFromUtf8(filePath), std::ios::binary);
  if (!stream.is_open()) {
    unsupportedReason = "native metadata reader could not open file";
    return std::nullopt;
  }

  constexpr std::uint64_t maxTopLevelScanBytes = 128ULL * 1024ULL * 1024ULL;
  constexpr std::uint64_t maxNativeMoovBytes = 8ULL * 1024ULL * 1024ULL;
  std::uint64_t scannedBytes = 0;
  std::vector<unsigned char> moov;

  while (scannedBytes < maxTopLevelScanBytes) {
    unsigned char header[8] = {};
    if (!readExact(stream, header, sizeof(header))) {
      break;
    }
    scannedBytes += 8;

    std::uint64_t boxSize = readBe32(header);
    const std::string type = mp4Type(header + 4);
    std::uint64_t headerSize = 8;
    if (boxSize == 1) {
      unsigned char largeSize[8] = {};
      if (!readExact(stream, largeSize, sizeof(largeSize))) {
        break;
      }
      boxSize = readBe64(largeSize);
      headerSize = 16;
      scannedBytes += 8;
    } else if (boxSize == 0) {
      unsupportedReason = "native metadata reader skipped unbounded MP4 box";
      return std::nullopt;
    }

    if (boxSize < headerSize) {
      break;
    }
    const std::uint64_t contentSize = boxSize - headerSize;
    if (type == "moov") {
      if (contentSize > maxNativeMoovBytes) {
        unsupportedReason = "native metadata reader skipped oversized MP4 moov box";
        return std::nullopt;
      }
      moov.resize(static_cast<std::size_t>(contentSize));
      if (!readExact(stream, moov)) {
        break;
      }
      break;
    }

    stream.seekg(static_cast<std::streamoff>(contentSize), std::ios::cur);
    if (!stream.good()) {
      break;
    }
    scannedBytes += contentSize;
  }

  if (moov.empty()) {
    unsupportedReason = "native metadata reader found no MP4 moov box";
    return std::nullopt;
  }

  NativeMetadataResult result;
  result.codec = "AAC";
  result.duration = 0;
  result.sources["duration"] = "unknown";
  result.sources["codec"] = "filename_fallback";
  result.sources["sampleRate"] = "unknown";
  result.sources["bitDepth"] = "unknown";
  result.sources["bitrate"] = "unknown";
  result.sources["bpm"] = "unknown";
  result.sources["replayGainTrackGainDb"] = "unknown";
  result.sources["replayGainAlbumGainDb"] = "unknown";
  result.sources["replayGainTrackPeak"] = "unknown";
  result.sources["replayGainAlbumPeak"] = "unknown";
  result.sources["replayGainIntegratedLufs"] = "unknown";

  const auto mvhd = findMp4Box(moov, 0, moov.size(), "mvhd");
  if (mvhd) {
    parseMp4Mvhd(moov, *mvhd, result);
  }

  const auto udta = findMp4Box(moov, 0, moov.size(), "udta");
  if (!udta) {
    unsupportedReason = "native metadata reader found no MP4 udta box";
    return std::nullopt;
  }
  const auto meta = findMp4Box(moov, udta->start + udta->headerSize, udta->start + udta->size, "meta");
  if (!meta || meta->start + meta->headerSize + 4 > meta->start + meta->size) {
    unsupportedReason = "native metadata reader found no MP4 meta box";
    return std::nullopt;
  }
  const auto ilst = findMp4Box(moov, meta->start + meta->headerSize + 4, meta->start + meta->size, "ilst");
  if (!ilst) {
    unsupportedReason = "native metadata reader found no MP4 ilst box";
    return std::nullopt;
  }

  std::map<std::string, std::vector<std::string>> tags;
  for (const Mp4Box& item : parseMp4Boxes(moov, ilst->start + ilst->headerSize, ilst->start + ilst->size)) {
    applyMp4IlstItem(moov, item, tags);
  }
  if (tags.empty()) {
    unsupportedReason = "native metadata reader found no supported MP4 metadata items";
    return std::nullopt;
  }

  applyVorbisTags(tags, filePath, result);
  result.hasVorbisComments = true;
  return result;
}

static std::optional<NativeMetadataResult> readNativeMetadata(const std::string& filePath, std::string& unsupportedReason) {
  const std::string extension = asciiLower(pathToUtf8(pathFromUtf8(filePath).extension()));
  if (extension == ".wav") {
    return readWaveMetadata(filePath, unsupportedReason);
  }
  if (extension == ".aiff" || extension == ".aif") {
    return readAiffMetadata(filePath, unsupportedReason);
  }
  if (extension == ".ogg" || extension == ".opus") {
    return readOggMetadata(filePath, unsupportedReason);
  }
  if (extension == ".flac" || extension == ".fla") {
    return readFlacMetadata(filePath, unsupportedReason);
  }
  if (extension == ".mp3") {
    return readMp3Id3Metadata(filePath, unsupportedReason);
  }
  if (extension == ".m4a" || extension == ".mp4" || extension == ".m4b" || extension == ".m4p") {
    return readMp4Metadata(filePath, unsupportedReason);
  }

  unsupportedReason = "native metadata reader currently supports WAV, AIFF, Ogg/Opus, FLAC, MP3, and M4A/MP4 only";
  return std::nullopt;
}

static void writeJsonStringField(const std::string& name, const std::string& value, bool& wroteField) {
  if (wroteField) {
    std::cout << ',';
  }
  wroteField = true;
  std::cout << "\"" << jsonEscape(name) << "\":\"" << jsonEscape(value) << "\"";
}

static void writeJsonNullableStringField(const std::string& name, const std::optional<std::string>& value, bool& wroteField) {
  if (wroteField) {
    std::cout << ',';
  }
  wroteField = true;
  std::cout << "\"" << jsonEscape(name) << "\":";
  if (value) {
    std::cout << "\"" << jsonEscape(*value) << "\"";
  } else {
    std::cout << "null";
  }
}

static void writeJsonNullableIntField(const std::string& name, const std::optional<int>& value, bool& wroteField) {
  if (wroteField) {
    std::cout << ',';
  }
  wroteField = true;
  std::cout << "\"" << jsonEscape(name) << "\":";
  if (value) {
    std::cout << *value;
  } else {
    std::cout << "null";
  }
}

static void writeNativeCapabilities() {
  std::cout
    << "{\"type\":\"capabilities\""
    << ",\"protocolVersion\":1"
    << ",\"supportedRequests\":[\"scan\",\"metadata\"]"
    << ",\"features\":[\"batching\",\"progress\",\"directorySnapshots\",\"persistentMetadata\"]"
    << ",\"metadataFormats\":[\"WAV/PCM\",\"AIFF/AIFC\",\"Ogg Vorbis\",\"Opus\",\"FLAC\",\"MP3\",\"M4A/MP4/ALAC\"]"
    << ",\"metadataExtensions\":[\".wav\",\".aiff\",\".aif\",\".ogg\",\".opus\",\".flac\",\".fla\",\".mp3\",\".m4a\",\".mp4\",\".m4b\",\".m4p\",\".alac\"]"
    << "}" << std::endl;
}

static void writeNativeMetadataResponse(const std::string& path, const NativeMetadataResult& result) {
  writeNativeCapabilities();
  std::cout << "{\"type\":\"ready\"}" << std::endl;
  std::cout << "{\"type\":\"started\",\"mode\":\"metadata\",\"path\":\"" << jsonEscape(path) << "\"}" << std::endl;
  std::cout << "{\"type\":\"metadata\",\"path\":\"" << jsonEscape(path) << "\",\"result\":{\"fields\":{";

  bool wroteField = false;
  writeJsonStringField("title", result.title, wroteField);
  writeJsonStringField("artist", result.artist, wroteField);
  writeJsonStringField("album", result.album, wroteField);
  writeJsonStringField("albumArtist", result.albumArtist, wroteField);
  writeJsonNullableIntField("trackNo", result.trackNo, wroteField);
  writeJsonNullableIntField("discNo", result.discNo, wroteField);
  writeJsonNullableIntField("year", result.year, wroteField);
  writeJsonNullableStringField("genre", result.genre, wroteField);
  std::cout << ",\"duration\":" << result.duration;
  std::cout << ",\"codec\":\"" << jsonEscape(result.codec) << "\"";
  std::cout << ",\"sampleRate\":";
  if (result.sampleRate) {
    std::cout << *result.sampleRate;
  } else {
    std::cout << "null";
  }
  std::cout << ",\"bitDepth\":";
  if (result.bitDepth) {
    std::cout << *result.bitDepth;
  } else {
    std::cout << "null";
  }
  std::cout << ",\"bitrate\":";
  if (result.bitrate) {
    std::cout << *result.bitrate;
  } else {
    std::cout << "null";
  }
  std::cout << ",\"bpm\":null";
  std::cout << ",\"replayGainTrackGainDb\":null,\"replayGainAlbumGainDb\":null";
  std::cout << ",\"replayGainTrackPeak\":null,\"replayGainAlbumPeak\":null,\"replayGainIntegratedLufs\":null";
  std::cout << "},\"fieldSources\":{";

  bool wroteSource = false;
  for (const auto& [key, source] : result.sources) {
    writeJsonStringField(key, source, wroteSource);
  }

  std::cout
    << "},\"embeddedMetadataStatus\":\"present\",\"embeddedCoverStatus\":\"missing\""
    << ",\"warnings\":[],\"errors\":[],\"status\":\"ok\"}}" << std::endl;
}

static void writeUnsupportedMetadataResponse(const std::string& path, const std::string& message) {
  writeNativeCapabilities();
  std::cout << "{\"type\":\"ready\"}" << std::endl;
  std::cout << "{\"type\":\"started\",\"mode\":\"metadata\",\"path\":\"" << jsonEscape(path) << "\"}" << std::endl;
  std::cout
    << "{\"type\":\"unsupported\",\"path\":\"" << jsonEscape(path)
    << "\",\"message\":\"" << jsonEscape(message) << "\"}" << std::endl;
}

int main() {
  std::ios::sync_with_stdio(false);

  std::string line;
  if (!std::getline(std::cin, line)) {
    std::cerr << "[echo-native-scanner] Missing request." << std::endl;
    return 2;
  }

  do {
    const std::string requestType = parseRequestType(line);
    if (requestType == "metadata") {
      const std::string path = parseStringField(line, "path").value_or("");
      if (path.empty()) {
        std::cerr << "[echo-native-scanner] Missing path in metadata request." << std::endl;
        return 2;
      }
      std::string unsupportedReason;
      const auto metadata = readNativeMetadata(path, unsupportedReason);
      if (metadata) {
        writeNativeMetadataResponse(path, *metadata);
      } else {
        writeUnsupportedMetadataResponse(path, unsupportedReason.empty() ? "native metadata reader unsupported" : unsupportedReason);
      }
      continue;
    }

    if (requestType != "scan") {
      std::cerr << "[echo-native-scanner] Unsupported request type: " << requestType << std::endl;
      return 2;
    }

    const ScanRequest request = parseRequest(line);
    if (request.root.empty()) {
      std::cerr << "[echo-native-scanner] Missing root in scan request." << std::endl;
      return 2;
    }

    writeNativeCapabilities();
    std::cout << "{\"type\":\"ready\"}" << std::endl;
    std::cout << "{\"type\":\"started\",\"root\":\"" << jsonEscape(request.root) << "\"}" << std::endl;

#ifdef _WIN32
    if (scanWindowsRoot(request)) {
      continue;
    }
#endif

    const fs::path root = pathFromUtf8(request.root);
    std::error_code errorCode;
    if (!fs::exists(root, errorCode) || !fs::is_directory(root, errorCode)) {
      writeError("directory", root, errorCode ? errorCode.message() : "root is not a directory");
      std::cout << "{\"type\":\"done\",\"files\":0,\"errors\":[]}" << std::endl;
      continue;
    }

    std::vector<fs::path> directories;
    directories.push_back(root);
    std::vector<ScanItem> batch;
    batch.reserve(request.batchSize);
    std::uint64_t directoryCount = 0;
    std::uint64_t fileCount = 0;

    while (!directories.empty()) {
      const fs::path directory = directories.back();
      directories.pop_back();
      directoryCount += 1;

      std::error_code readError;
      fs::directory_iterator iterator(directory, fs::directory_options::skip_permission_denied, readError);
      if (readError) {
        writeError("directory", directory, readError.message());
        continue;
      }

      std::vector<SnapshotEntry> snapshotEntries;
      for (const fs::directory_entry& entry : iterator) {
        std::error_code directoryError;
        if (entry.is_directory(directoryError)) {
          directories.push_back(entry.path());
          snapshotEntries.push_back({ pathToUtf8(entry.path().filename()), "directory" });
          continue;
        }

        if (directoryError) {
          writeError("file_stat", entry.path(), directoryError.message());
          continue;
        }

        const std::string extension = asciiLower(pathToUtf8(entry.path().extension()));
        if (std::find(request.extensions.begin(), request.extensions.end(), extension) == request.extensions.end()) {
          continue;
        }

        std::error_code fileTypeError;
        if (!entry.is_regular_file(fileTypeError)) {
          if (fileTypeError) {
            writeError("file_stat", entry.path(), fileTypeError.message());
          }
          continue;
        }
        snapshotEntries.push_back({ pathToUtf8(entry.path().filename()), "file" });

        std::error_code sizeError;
        const auto sizeBytes = fs::file_size(entry.path(), sizeError);
        if (sizeError) {
          writeError("file_stat", entry.path(), sizeError.message());
          continue;
        }

        std::error_code timeError;
        const auto modifiedAt = fs::last_write_time(entry.path(), timeError);
        if (timeError) {
          writeError("file_stat", entry.path(), timeError.message());
          continue;
        }

        batch.push_back({ pathToUtf8(entry.path()), sizeBytes, fileTimeToUnixMs(modifiedAt) });
        fileCount += 1;
        if (batch.size() >= request.batchSize) {
          writeBatch(batch);
          batch.clear();
        }
      }

      std::error_code directoryTimeError;
      const auto directoryModifiedAt = fs::last_write_time(directory, directoryTimeError);
      if (!directoryTimeError) {
        writeDirectorySnapshot(directory, fileTimeToUnixMs(directoryModifiedAt), snapshotEntries);
      }

      if (directoryCount % 20 == 0) {
        std::cout << "{\"type\":\"progress\",\"directories\":" << directoryCount << ",\"files\":" << fileCount << "}" << std::endl;
      }
    }

    writeBatch(batch);
    std::cout << "{\"type\":\"done\",\"files\":" << fileCount << ",\"errors\":[]}" << std::endl;
  } while (std::getline(std::cin, line));

  return 0;
}
