#include <iostream>
#include <string>
#include <nlohmann/json.hpp>
int main() {
    // Mỗi lượt đọc đúng một dòng JSON; chương trình khởi động lại mỗi lượt.
    std::string line;
    if (!std::getline(std::cin, line)) return 1;
    auto request = nlohmann::json::parse(line);
    // THAY CHIẾN THUẬT Ở ĐÂY: mẫu chọn nước hợp lệ đầu tiên, chưa tối ưu để thắng.
    // state.board là bàn cờ; player_index là bên của bạn; legal_moves là nước được phép.
    // Thư viện JSON đã có sẵn.
    auto move = request.at("legal_moves").at(0);
    // Chỉ ghi một dòng JSON ra cout; ghi debug vào cerr. Giữ nguyên request_id.
    // Thay nullptr bằng dữ liệu JSON nhỏ trong userdata nếu cần nhớ giữa các lượt.
    std::cout << nlohmann::json{{"request_id", request.at("request_id")}, {"move", move}, {"userdata", nullptr}}.dump() << '\n';
}
