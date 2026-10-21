// Read-only guidance; API permissions and action eligibility remain authoritative.
function tournamentProgress({ tournament, swiss, bracket, finalRule, intake, dirtyRoster = false }) {
  const result = (step, title, text, target) => ({ step, title, text, target });
  if (!tournament) return result(1, 'Tạo hoặc chọn giải', 'Chọn một giải đã tạo ở trên, hoặc nhập tên, chọn luật và lưu giải mới bên dưới.', 'tournament-name');
  if (tournament.status === 'cancelled' || swiss?.status === 'cancelled' || bracket?.status === 'cancelled') return result(6, 'Giải đã hủy', 'Giữ lịch sử để đối chiếu. Phiên đã hủy không thể tiếp tục hoặc duyệt đội vô địch.', 'tournament-events');
  if (tournament.status === 'finished' || bracket?.publishedAt) return result(6, 'Đã duyệt kết quả', 'Giải đã kết thúc. Xem sơ đồ và kết quả đã duyệt bên dưới.', 'tournament-bracket');
  if (tournament.status === 'draft') {
    if (dirtyRoster) return result(1, 'Lưu danh sách đội', 'Danh sách có thay đổi chưa lưu. Lưu danh sách trước khi mở nhận bài.', 'tournament-roster-save');
    if (tournament.entrants.length < 2) return result(1, 'Chọn ít nhất hai đội', 'Chọn tài khoản đội và bấm Lưu danh sách đội. Nếu chưa có tài khoản, mở mục Thí sinh để cấp trước.', 'tournament-team-search');
    return result(2, 'Kiểm tra lịch rồi mở nhận bài', 'Kiểm tra luật, hạn đóng và danh sách đã lưu. Sau khi mở, gửi tên giải và hạn nộp cho thí sinh.', 'tournament-open');
  }
  const stage = tournament.stages?.[0];
  if (stage?.status === 'open') {
    if (stage.serverNow < stage.opensAt) return result(2, 'Chờ đến giờ mở nhận bài', 'Giải đã có lịch. Thí sinh chỉ nộp được khi đến giờ mở; xem thời gian tại phần nhận bài.', 'tournament-stage-info');
    return result(2, 'Theo dõi bài nộp', 'Nhắc thí sinh chọn đúng tên giải. Khi kết thúc thời gian nhận bài, đóng nhận bài để chuẩn bị chốt bot.', 'tournament-close');
  }
  if (stage?.status === 'closing') return result(2, 'Chờ kiểm tra xong rồi chốt bot', 'Bài đã nhận đúng hạn vẫn được xử lý. Kiểm tra hàng đợi, xử lý lỗi máy chủ nếu có, nhập lý do rồi chốt bot.', 'tournament-lock');
  if (!swiss) return result(3, 'Tải trạng thái thi đấu', 'Dữ liệu vòng loại chưa sẵn sàng. Bấm Tải lại dữ liệu; không cần chốt hoặc tạo lại giải.', 'tournament-refresh');
  if (swiss.status === 'not_started') return result(3, 'Bắt đầu vòng loại', 'Kiểm tra số bot đã chốt, số vòng và tổng số ván dự kiến trước khi bắt đầu.', 'swiss-start');
  if (swiss.status === 'paused') return result(3, 'Vòng loại đang tạm dừng', 'Kiểm tra nguyên nhân, nhập lý do rồi tiếp tục khi đã xử lý sự cố.', 'swiss-resume');
  if (swiss.status === 'running') return swiss.rounds.at(-1)?.status === 'finished'
    ? result(3, 'Tạo lượt đấu tiếp theo', 'Lượt hiện tại đã xong. Kiểm tra bảng điểm rồi tạo lượt tiếp theo.', 'swiss-next')
    : result(3, 'Chờ các ván vòng loại hoàn tất', 'Theo dõi tiến độ và mở bản xem lại bên dưới. Nếu có ván lỗi máy chủ, kiểm tra lỗi trước khi chạy lại.', 'swiss-status');
  if (!swiss.qualification) return result(4, 'Duyệt đội đi tiếp', 'Vòng loại đã xong. Kiểm tra bảng điểm, số đội đi tiếp và lý do duyệt trước khi chốt danh sách.', 'qualification-count');
  if (intake && intake.stage.status !== 'locked') return result(4, 'Hoàn tất đợt nộp lại', 'Đã mở đợt nộp lại nên cần đóng nhận bài và chốt đủ bot chính thức trước khi chạy loại trực tiếp.', 'final-intake-status');
  if (finalRule?.requiresResubmission && !intake) return result(4, 'Mở nhận bài theo luật mới', 'Luật chính thức khác vòng loại. Công bố thông báo và lịch nộp lại cho các đội đi tiếp.', 'final-intake-announcement');
  if (!bracket) return result(5, 'Tạo sơ đồ loại trực tiếp', 'Kiểm tra danh sách đã duyệt và chính sách luật. Nhập lý do rồi tạo sơ đồ; bước này chưa chạy trận.', 'bracket-create');
  if (bracket.status === 'planned') return result(5, 'Chọn cách chạy loại trực tiếp', 'Kiểm tra sơ đồ, nhập lý do rồi chọn chạy toàn bộ hoặc từng cặp/vòng. Không đổi chế độ sau khi bắt đầu.', 'bracket-start');
  if (bracket.status === 'paused') return result(5, 'Loại trực tiếp đang tạm dừng', 'Kiểm tra sự cố, nhập lý do rồi tiếp tục khi sẵn sàng.', 'bracket-resume');
  if (bracket.status === 'finished') return result(6, 'Kiểm tra và duyệt kết quả', 'Đã có kết quả chung kết nhưng chưa công bố chính thức. Đối chiếu kết quả, nhập lý do rồi duyệt kết thúc giải.', 'bracket-publish');
  return result(5, 'Theo dõi loại trực tiếp', 'Xem các cặp đấu và bản xem lại. Nếu dùng chế độ từng cặp/vòng, chọn cặp hoặc vòng cần chạy trong sơ đồ.', 'tournament-bracket');
}
if (typeof module !== 'undefined' && module.exports) module.exports = { tournamentProgress };
