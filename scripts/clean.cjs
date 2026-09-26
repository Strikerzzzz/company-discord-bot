// Xoá thư mục output trước khi build: tsc không tự xoá file .js cũ, mà loader nạp mọi file trong thư mục
// (file của command đã xoá sẽ vẫn bị nạp nếu còn trong build/). Dùng: node scripts/clean.cjs <thư mục>...
const { rmSync } = require("fs");

for (const target of process.argv.slice(2)) rmSync(target, { recursive: true, force: true });
