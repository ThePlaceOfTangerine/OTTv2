#include <iostream>
#include <string>
#include <algorithm>
#include <cstdlib>
#include <nlohmann/json.hpp>
using nlohmann::json;

int main() {
    std::string line;
    if (!std::getline(std::cin, line)) return 1;
    const auto request = json::parse(line);
    const int player = request.at("player_index");
    const auto home = request.at("rules").at("homes").at(1 - player);
    const auto board = request.at("state").at("board");
    json best;
    int bestScore = -100000;
    for (const auto& move : request.at("legal_moves")) {
        int r = move.at("toRow"), c = move.at("toCol");
        int distance = std::max(std::abs(r - home.at("row").get<int>()), std::abs(c - home.at("col").get<int>()));
        int score = (board.at(r).at(c).is_null() ? 0 : 4) - distance;
        if (score > bestScore) { bestScore = score; best = move; }
    }
    std::cout << json{{"request_id", request.at("request_id")}, {"move", best}, {"userdata", nullptr}}.dump() << '\n';
    return 0;
}
