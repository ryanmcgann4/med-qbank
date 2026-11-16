// Apply the saved theme before the app paints (a separate file so the page's
// Content-Security-Policy can forbid inline scripts).
try {
  var t = localStorage.getItem('qbank-theme') || 'system';
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
