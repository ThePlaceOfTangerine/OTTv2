#include <iostream>
#include <string>
#include <algorithm>
#include <cstdlib>
#include <nlohmann/json.hpp>
using nlohmann::json;

int main() {
    // PHẦN ĐỌC DỮ LIỆU: nhận một lượt từ hệ thống.
    std::string line;
    if (!std::getline(std::cin, line)) return 1;
    const auto request = json::parse(line);
    const int player = request.at("player_index");
    const auto& board = request.at("state").at("board");
    const auto& home = request.at("rules").at("homes").at(1 - player);
    // Luật cũ không có powerUps/tiles: dùng danh sách rỗng.
    const auto powerUps = request.at("state").value("powerUps", json::array());
    // Luật mới: state.tiles có type + tags; loại ô có "effect" trong
    // rules.tileTypes là ô hiệu ứng (wildcard, shield, dash...).
    const auto tiles = request.at("state").value("tiles", json::array());
    const auto tileTypes = request.at("rules").value("tileTypes", json::object());
    auto effectTile = [&](int r, int c) {
        for (const auto& tile : tiles)
            if (tile.at("row").get<int>() == r && tile.at("col").get<int>() == c &&
                !tileTypes.value(tile.at("type").get<std::string>(), json::object()).value("effect", json()).is_null())
                return true;
        return false;
    };

    // THAY CHIẾN THUẬT Ở ĐÂY.
    // legal_moves đã xét ô chặn, ô ngoài bản đồ, kiểu đi từng loại và ăn quân.
    // Không tự giới hạn khoảng cách 1 ô hoặc mặc định bàn cờ 9 x 9.
    auto score = [&](const json& move) {
        const int r = move.at("toRow"), c = move.at("toCol");
        const auto& piece = board.at(move.at("fromRow").get<int>())
                                 .at(move.at("fromCol").get<int>());
        if (r == home.at("row").get<int>() && c == home.at("col").get<int>())
            return 100000; // Chiếm nhà là thắng ngay.
        const auto& target = board.at(r).at(c);
        int points = 0;
        // Quân có khiên (effect == "shield") không bị ăn: nước này chỉ làm vỡ khiên.
        if (!target.is_null()) points = target.value("effect", std::string()) == "shield" ? 5 : 40;
        // Quân đã có powered hoặc effect thì không cần ưu tiên nhặt thêm.
        if (!piece.value("powered", false) && !piece.contains("effect")) {
            bool bonus = effectTile(r, c);
            for (const auto& position : powerUps)
                if (position.at(0).get<int>() == r && position.at(1).get<int>() == c) bonus = true;
            if (bonus) points += 15;
        }
        // Gợi ý gần nhà, không phải số lượt đến nhà trên bản đồ tùy chỉnh.
        const int distance = std::max(std::abs(r - home.at("row").get<int>()),
                                      std::abs(c - home.at("col").get<int>()));
        return points - distance;
    };
    auto move = request.at("legal_moves").at(0);
    int bestScore = score(move);
    for (const auto& candidate : request.at("legal_moves")) {
        const int points = score(candidate);
        if (points > bestScore) { bestScore = points; move = candidate; }
    }

    // PHẦN GỬI NƯỚC ĐI: giữ nguyên. Không in lời chào vào stdout.
    // Nhật ký: std::cerr << "kiem tra"; Bot chạy lại mỗi lượt.
    // userdata là phần nhớ giữa các lượt, để nullptr nếu chưa cần.
    std::cout << json{{"request_id", request.at("request_id")}, {"move", move},
                      {"userdata", nullptr}}.dump() << '\n';
}
