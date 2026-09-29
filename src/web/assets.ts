// CSS nền của trang web quản trị (DEC-039), phục vụ ở /static/app.css (CSP chặn style inline). Trang nào cần thêm thì khai báo
// `css` trong PageModule; server nối vào sau phần này.
export const BASE_CSS = `
:root {
	--bg: #f4f5fb; --panel: #ffffff; --text: #1f2330; --muted: #6b7185; --line: #e3e5ef;
	--brand: #5865f2; --brand-dark: #4752c4; --ok: #1f9d55; --ok-bg: #e6f6ec; --err: #d93025; --err-bg: #fde8e7;
	--warn: #b7791f; --warn-bg: #fdf3e1; --radius: 10px;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; background: var(--bg); color: var(--text); font-size: 15px; line-height: 1.5; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: #eef0f8; padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 24px; background: var(--brand); color: #fff; }
.topbar .brand { font-weight: 700; font-size: 17px; }
.topbar .who { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.topbar .who a { color: #fff; }
.topbar form { margin: 0; }
.shell { display: flex; min-height: calc(100vh - 56px); }
.sidebar { width: 230px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--line); padding: 16px 10px; }
.sidebar a { display: block; padding: 9px 12px; border-radius: 8px; color: var(--text); }
.sidebar a:hover { background: #eef0fb; text-decoration: none; }
.sidebar a.active { background: var(--brand); color: #fff; font-weight: 600; }
.sidebar .guild { padding: 4px 12px 12px; font-weight: 600; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .03em; }
main { flex: 1; padding: 24px 32px; max-width: 1100px; }
h1 { font-size: 24px; margin: 0 0 6px; }
h2 { font-size: 18px; margin: 0 0 12px; }
h3 { font-size: 15px; margin: 16px 0 8px; }
.lead { color: var(--muted); margin: 0 0 20px; }
.muted { color: var(--muted); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 18px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.stat .label { color: var(--muted); font-size: 13px; }
.stat .value { font-size: 20px; font-weight: 700; }
.flash { padding: 12px 16px; border-radius: var(--radius); margin-bottom: 18px; border: 1px solid transparent; }
.flash.ok { background: var(--ok-bg); border-color: #b9e3c8; }
.flash.error { background: var(--err-bg); border-color: #f5c2bf; }
.warn-box { background: var(--warn-bg); border: 1px solid #f1d9ad; border-radius: var(--radius); padding: 10px 14px; margin: 10px 0; }
table.table { width: 100%; border-collapse: collapse; }
table.table th, table.table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
table.table th { color: var(--muted); font-weight: 600; font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; max-width: 420px; }
.field label { font-weight: 600; }
.field .hint { color: var(--muted); font-size: 13px; }
input[type=text], input[type=number], select { font: inherit; padding: 8px 10px; border: 1px solid #cfd3e3; border-radius: 8px; background: #fff; color: var(--text); }
input[type=checkbox], input[type=radio] { width: 17px; height: 17px; accent-color: var(--brand); }
.check { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.btn { display: inline-block; font: inherit; font-weight: 600; padding: 9px 16px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; background: #e8eaf4; color: var(--text); }
.btn:hover { filter: brightness(0.96); text-decoration: none; }
.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover { background: var(--brand-dark); }
.btn-danger { background: var(--err); color: #fff; }
.btn-link { background: transparent; color: inherit; padding: 0; border: 0; text-decoration: underline; }
.btn-discord { background: var(--brand); color: #fff; font-size: 17px; padding: 12px 22px; }
.actions { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #eceef6; color: var(--muted); }
.badge.ok { background: var(--ok-bg); color: var(--ok); }
.badge.off { background: var(--err-bg); color: var(--err); }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.chip { display: inline-block; padding: 1px 8px; border-radius: 6px; background: #eef0fb; font-weight: 600; }
.chip-missing { background: var(--err-bg); color: var(--err); }
.mention { background: #e6e8fd; color: var(--brand-dark); padding: 0 4px; border-radius: 4px; font-weight: 600; }
.login { max-width: 460px; margin: 10vh auto; text-align: center; }
.login .card { padding: 32px 28px; }
@media (max-width: 760px) {
	.shell { flex-direction: column; }
	.sidebar { width: auto; border-right: 0; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px; }
	.sidebar .guild { width: 100%; }
	main { padding: 16px; }
}
`;
