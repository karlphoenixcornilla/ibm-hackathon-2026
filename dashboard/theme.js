(() => {
  const root = document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try {
    const saved = localStorage.getItem('reprise-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Theme switching still works when storage is unavailable. */ }

  function applyTheme() {
    const dark = (preference || (systemTheme.matches ? 'dark' : 'light')) === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-checked', String(dark));
      toggle.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
    }
  }

  applyTheme();
  systemTheme.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('reprise-theme', preference);
      } catch { /* Keep the selected theme for this visit. */ }
      applyTheme();
    });
  });
})();
