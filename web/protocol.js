document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
      button.textContent = 'Đã sao chép';
      status.textContent = button.dataset.copy === 'request-code' ? 'Đã sao chép ví dụ đầu vào rút gọn; rules và board chưa đầy đủ.' : 'Đã sao chép phản hồi JSON một dòng.';
      setTimeout(() => { button.textContent = 'Sao chép'; }, 2000);
    } catch {
      button.textContent = 'Hãy chọn và sao chép code';
      status.textContent = 'Trình duyệt chưa cho phép sao chép tự động. Bạn có thể chọn nội dung trong khung code và sao chép.';
    }
  });
});
