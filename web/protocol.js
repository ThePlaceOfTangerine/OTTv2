document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
      button.textContent = 'Đã sao chép';
      status.textContent = button.dataset.copy === 'response-code'
        ? 'Đã sao chép ví dụ câu trả lời. Chỉ dùng nước này nếu nó có trong danh sách nước được phép của lượt đó.'
        : 'Đã sao chép dòng chọn nước. Dán vào phần chiến thuật của mã mẫu cùng ngôn ngữ.';
      setTimeout(() => { button.textContent = 'Sao chép'; }, 2000);
    } catch {
      button.textContent = 'Hãy chọn và sao chép code';
      status.textContent = 'Trình duyệt chưa cho phép sao chép tự động. Bạn có thể chọn nội dung trong khung code và sao chép.';
    }
  });
});
