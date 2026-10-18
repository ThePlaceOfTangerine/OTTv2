#include <iostream>
#include <string>
#include <nlohmann/json.hpp>
int main() {
    // PHẦN ĐỌC DỮ LIỆU: đã làm sẵn, bạn có thể giữ nguyên.
    std::string line;
    if (!std::getline(std::cin, line)) return 1;
    auto request = nlohmann::json::parse(line);

    // THAY CHIẾN THUẬT Ở ĐÂY.
    // legal_moves là danh sách nước được phép; at(0) chọn nước đầu tiên.
    // Bạn có thể chọn nước khác trong danh sách để bot chơi tốt hơn.
    // Bàn cờ: request.at("state").at("board").
    // Bên của bạn: request.at("player_index") (0 hoặc 1).
    auto move = request.at("legal_moves").at(0);

    // PHẦN GỬI NƯỚC ĐI: đã làm sẵn, bạn có thể giữ nguyên.
    // Không thêm cout để in lời chào vào câu trả lời này.
    // Muốn tự kiểm tra code, dùng luồng riêng: std::cerr << "kiem tra";
    // Chương trình chạy lại từ đầu mỗi lượt. userdata là phần ghi nhớ giữa các lượt;
    // cứ để nullptr nếu chưa cần dùng.
    std::cout << nlohmann::json{{"request_id", request.at("request_id")}, {"move", move}, {"userdata", nullptr}}.dump() << '\n';
}
