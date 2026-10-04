// website/config.js
// Публичный конфиг. Здесь только publishable (anon) key — он по дизайну публичный.
// service_role / secret key здесь НИКОГДА не должен появляться.

window.NEXPLAY_CONFIG = {
  SUPABASE_URL: "https://qccjctqjmefpbjxmhqsu.supabase.co",
  SUPABASE_KEY: "sb_publishable_UrtcULmrStnAwlqt4ENayQ_bbtu6_Zd",

  // Лимит на один файл билда — 50 МБ (free tier Supabase Storage)
  MAX_BUILD_FILE_SIZE: 50 * 1024 * 1024,

  // Палитра (используется и в CSS, и в JS-графике)
  COLORS: {
    bg: "#0B0B0F",
    surface: "#111118",
    surface2: "#171720",
    accent: "#7C5CFF",
    accent2: "#3EA6FF",
    text: "#E8E8F0",
    muted: "#8A8AA0",
    danger: "#FF5C7C",
    success: "#4CD97B",
  },
};