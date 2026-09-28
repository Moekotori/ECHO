#pragma once

namespace taskbar_icons {

constexpr bool previousShape(const int x, const int y) {
  const int distance = y >= 7 ? y - 7 : 7 - y;
  const bool bar = x >= 2 && x <= 3 && y >= 3 && y <= 12;
  const bool triangle = x >= 4 && x <= 12 && y >= 3 && y <= 12 && distance <= (x - 4) / 2 + 1;
  return bar || triangle;
}

constexpr bool nextShape(const int x, const int y) {
  return previousShape(15 - x, y);
}

constexpr bool playShape(const int x, const int y) {
  const int distance = y >= 7 ? y - 7 : 7 - y;
  // Wide at the left edge, narrowing to a point on the right.
  return x >= 4 && x <= 12 && y >= 2 && y <= 13 && distance <= (12 - x) / 2;
}

constexpr bool pauseShape(const int x, const int y) {
  return y >= 2 && y <= 13 && ((x >= 4 && x <= 6) || (x >= 10 && x <= 12));
}

constexpr const char* sequentialMask[] = {
    "0000000000000000", "0000000000000000", "0000000000000000", "0000000000100000",
    "0011111111110000", "0011111111111000", "0000000000100000", "0000000000000000",
    "0000000000000000", "0000000000100000", "0011111111110000", "0011111111111000",
    "0000000000100000", "0000000000000000", "0000000000000000", "0000000000000000",
};

constexpr const char* shuffleMask[] = {
    "0000000000000000", "0000000000000000", "0000000000010000", "0011100000111000",
    "0000110001111100", "0000011011011000", "0000001110010000", "0000000110000000",
    "0000001110000000", "0000011011010000", "0000110001111000", "0011100001111100",
    "0000000000111000", "0000000000010000", "0000000000000000", "0000000000000000",
};

constexpr const char* repeatOneMask[] = {
    "0000000000000000", "0000000000000000", "0000000000100000", "0001111111110000",
    "0011000000111000", "0010000000100000", "0010000110000000", "0010001110000100",
    "0010000110000100", "0000000110000100", "0000100110000100", "0001110000001100",
    "0000111111111000", "0000100000000000", "0000000000000000", "0000000000000000",
};

constexpr bool sequentialShape(const int x, const int y) { return sequentialMask[y][x] == '1'; }
constexpr bool shuffleShape(const int x, const int y) { return shuffleMask[y][x] == '1'; }
constexpr bool repeatOneShape(const int x, const int y) { return repeatOneMask[y][x] == '1'; }

static_assert(playShape(4, 3) && !playShape(12, 3) && playShape(12, 7), "Play must point right");
static_assert(previousShape(4, 7) && !previousShape(4, 3), "Previous must point left");
static_assert(nextShape(11, 7) && !nextShape(11, 3), "Next must point right");
static_assert(pauseShape(4, 7) && pauseShape(12, 7) && !pauseShape(8, 7), "Pause must have two bars");

}  // namespace taskbar_icons
