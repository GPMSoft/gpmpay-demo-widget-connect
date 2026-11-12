const $ = (selector) => document.querySelector(selector);
let config = { sandbox: false };
let banks = [];
let accounts = [];
const sessionResults = new Map();

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function log(name, data) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString("vi-VN")} ${name} ${data === undefined ? "" : JSON.stringify(data)}`;
  $("#callback-log").prepend(li);
}

const money = (v) => Number(v).toLocaleString("vi-VN");
const date = (v) => (v ? new Date(v).toLocaleString("vi-VN") : "—");
const escape = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const savingPercent = (plan) =>
  plan.salePrice === null ? 0 : Math.round((1 - Number(plan.salePrice) / Number(plan.price)) * 100);

/** Thẻ chọn gói khi tạo bill gia hạn — đối tác thật hiển thị y như vậy trên FE của họ, rồi gửi `plan.id` lên. */
function renderPlans(container, bank, inputName) {
  if (!bank || bank.plans.length === 0) {
    container.innerHTML = '<p class="empty">Ngân hàng này chưa có gói nào.</p>';
    return;
  }
  const checkedId = bank.plans[0].id;
  container.innerHTML = bank.plans
    .map((plan) => {
      const saving = savingPercent(plan);
      const perMonth = Math.round(plan.amount / plan.planMonths);
      return `<label class="choice">
        <input type="radio" name="${inputName}" value="${plan.id}" required ${plan.id === checkedId ? "checked" : ""} />
        ${saving > 0 ? `<span class="badge">-${saving}%</span>` : ""}
        <span class="title">${plan.planMonths} tháng</span>
        <span class="price">${money(plan.amount)}đ</span>
        ${saving > 0 ? `<span class="was">${money(plan.price)}đ</span>` : ""}
        <span class="sub">≈ ${money(perMonth)}đ/tháng</span>
      </label>`;
    })
    .join("");
}

async function loadBanks() {
  banks = await call("GET", "/api/banks");
  $("#banks").innerHTML = banks
    .map(
      (b) => `<tr>
        <td>${escape(b.code)}</td>
        <td>${escape(b.name)}</td>
        <td><code>${escape(b.bin)}</code></td>
        <td>${b.plans.map((p) => `${p.planMonths} tháng`).join(", ") || "—"}</td>
      </tr>`,
    )
    .join("");
}

/** Hộp chọn gói cho một STK; chỉ hiện gói của đúng ngân hàng STK đó. */
function pickPlan(account, { title, hint, okText }) {
  const dialog = $("#plan-dialog");
  const bank = banks.find((b) => b.code === account.bankCode);
  $("#plan-dialog-title").textContent = title;
  $("#plan-dialog-hint").innerHTML = hint;
  $("#plan-dialog-ok").textContent = okText;
  $("#plan-dialog-account").textContent = `${account.bankCode} ${account.accountNumber}`;
  renderPlans($("#plan-dialog-picker"), bank, "newPlanId");
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const picked = dialog.querySelector("input[name=newPlanId]:checked");
        resolve(dialog.returnValue === "save" && picked ? picked.value : null);
      },
      { once: true },
    );
  });
}

function askSimulation(account) {
  const dialog = $("#simulate-dialog");
  $("#simulate-dialog-account").textContent = `${account.bankCode} ${account.accountNumber}`;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const form = new FormData(dialog.querySelector("form"));
        resolve(
          dialog.returnValue === "save"
            ? { type: form.get("type"), amount: form.get("amount"), transferContent: form.get("transferContent") }
            : null,
        );
      },
      { once: true },
    );
  });
}

/** Mở widget bằng link_token server vừa tạo; kết quả báo về qua callback. */
/** Đọc tuỳ chọn hiển thị: popup (có thể chỉnh kích thước) hoặc nhúng, font và cỡ chữ. */
function displayOptions() {
  const form = new FormData($("#display-form"));
  const number = (name) => Number(form.get(name)) || undefined;
  const fontFamily = form.get("fontFamily") || undefined;
  const inline = form.get("display") === "inline";
  $("#inline-section").hidden = !inline;
  $("#inline-widget").innerHTML = "";
  return {
    ...(inline
      ? { container: "#inline-widget" }
      : { popup: { width: number("popupWidth"), height: number("popupHeight") } }),
    appearance: {
      fontFamily,
      fontUrl: fontFamily
        ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;600;700&display=swap`
        : undefined,
      fontSize: number("fontSize"),
    },
  };
}

function openWidget(linkToken, sessionId) {
  const options = displayOptions();
  if (options.container) $("#inline-section").scrollIntoView({ behavior: "smooth" });
  window.GPMPayConnect.open({
    ...options,
    token: linkToken,
    onSuccess: (result) => {
      log("onSuccess", result);
      $("#inline-section").hidden = true;
      reloadAll();
      checkSession(sessionId);
    },
    // Người dùng có thể đóng widget sau khi đã kết nối xong: tra lại phiên để biết kết quả thật.
    onExit: (exit) => {
      log("onExit", exit);
      $("#inline-section").hidden = true;
      checkSession(sessionId);
    },
    onEvent: (name, data) => log(`onEvent:${name}`, data),
  });
}

$("#connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const { linkToken, sessionId } = await call("POST", "/api/connect", {
      email: form.get("email"),
      name: form.get("name"),
      phone: form.get("phone"),
      autoWebhook: form.get("autoWebhook") === "on",
    });
    log("Đã tạo phiên", { sessionId });
    loadSessions().catch((err) => log("Lỗi tải", err.message));
    openWidget(linkToken, sessionId);
  } catch (err) {
    log("Lỗi tạo phiên", err.message);
    alert(err.message);
  }
});

const accountData = (a) =>
  `data-bank="${escape(a.bank.code)}" data-account-number="${escape(a.accountNumber)}"`;

async function loadAccounts() {
  const day = $("#expiry-filter").elements.expiresBefore.value;
  // Hết ngày đã chọn theo giờ Việt Nam.
  const query = day ? `?expiresBefore=${encodeURIComponent(`${day}T23:59:59.999+07:00`)}` : "";
  const { data } = await call("GET", `/api/bank-accounts${query}`);
  if (!day) fillTransactionAccounts(data);
  $("#accounts").innerHTML = data
    .map(
      (a) => `<tr>
        <td>${escape(a.user.email)}</td>
        <td>${escape(a.bank.shortName)} ${escape(a.accountNumber)}<br><small>${escape(a.ownerName)}</small></td>
        <td>${escape(a.platform?.name ?? "—")}</td>
        <td>${a.deletedAt ? "Đã huỷ" : escape(a.status)}${a.active ? ' · <span class="ok">còn hạn</span>' : ' · <span class="bad">chưa có hạn</span>'}</td>
        <td>${date(a.expiresAt)}</td>
        <td>${
          a.deletedAt
            ? ""
            : `<div class="actions">
                <button class="small" data-create-bill="${a.id}" ${accountData(a)}>Tạo bill gia hạn</button>
                ${config.paymentSimulation ? `<button class="small" data-simulate="${a.id}" ${accountData(a)}>Giả lập giao dịch</button>` : ""}
                <button class="small danger" data-disconnect="${a.id}">Huỷ kết nối</button>
              </div>`
        }</td>
      </tr>`,
    )
    .join("");
}

const selectedAccounts = new Set();
let activeOption = 0;

function fillTransactionAccounts(data) {
  accounts = data;
  renderAccountCombo();
}

const accountText = (a) =>
  `${a.bank.code} ${a.bank.shortName} ${a.accountNumber} ${a.ownerName} ${a.user.email}`.toLowerCase();

function filteredAccounts() {
  const words = $("#account-search").value.toLowerCase().split(/\s+/).filter(Boolean);
  return accounts.filter((a) => words.every((w) => accountText(a).includes(w)));
}

function renderAccountCombo() {
  $("#account-chips").innerHTML = [...selectedAccounts]
    .map(
      (id) =>
        `<span class="chip">${escape(accountLabel(id))}<button type="button" data-unselect="${escape(id)}" aria-label="Bỏ chọn">×</button></span>`,
    )
    .join("");
  $("#account-search").placeholder = selectedAccounts.size ? "Thêm STK…" : "Tất cả — gõ để tìm STK, ngân hàng, email";
  const options = filteredAccounts();
  activeOption = Math.min(activeOption, Math.max(options.length - 1, 0));
  $("#account-options").innerHTML = options.length
    ? options
        .map(
          (a, i) =>
            `<li role="option" id="account-option-${i}" data-account="${a.id}" aria-selected="${selectedAccounts.has(a.id)}" class="${i === activeOption ? "active" : ""}">
              <span>${escape(a.bank.code)} ${escape(a.accountNumber)}${a.deletedAt ? " (đã huỷ)" : ""}</span>
              <small>${escape(a.ownerName)} · ${escape(a.user.email)}</small>
            </li>`,
        )
        .join("")
    : '<li class="empty">Không có STK phù hợp</li>';
  $("#account-search").setAttribute("aria-activedescendant", options.length ? `account-option-${activeOption}` : "");
}

function toggleAccountList(open) {
  $("#account-options").hidden = !open;
  $("#account-search").setAttribute("aria-expanded", String(open));
}

function toggleAccount(id) {
  if (selectedAccounts.has(id)) selectedAccounts.delete(id);
  else selectedAccounts.add(id);
  $("#account-search").value = "";
  renderAccountCombo();
}

const accountLabel = (id) => {
  const a = accounts.find((x) => x.id === id);
  return a ? `${a.bank.code} ${a.accountNumber}` : id;
};

async function loadTransactions() {
  const form = new FormData($("#transaction-filter"));
  const query = new URLSearchParams();
  if (selectedAccounts.size) query.set("bankAccountId", [...selectedAccounts].join(","));
  for (const key of ["transferType", "source"]) {
    if (form.get(key)) query.set(key, form.get(key));
  }
  // Mốc ngày theo giờ Việt Nam.
  if (form.get("from")) query.set("startDate", `${form.get("from")}T00:00:00+07:00`);
  if (form.get("to")) query.set("endDate", `${form.get("to")}T23:59:59.999+07:00`);
  const { data } = await call("GET", `/api/transactions?${query}`);
  $("#transactions").innerHTML = data.length
    ? data
        .map(
          (t) => `<tr>
        <td>${date(t.transactionTime)}</td>
        <td>${escape(accountLabel(t.bankAccountId))}</td>
        <td>${t.type === "IN" ? '<span class="ok">vào</span>' : '<span class="bad">ra</span>'}</td>
        <td><strong>${money(t.amount)}</strong></td>
        <td>${escape(t.transferContent)}</td>
        <td><code>${escape(t.referenceCode)}</code></td>
        <td>${escape(t.source)}</td>
      </tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="empty">Không có giao dịch.</td></tr>';
}

const SESSION_STATUS_LABEL = {
  PENDING: "Chưa mở widget",
  OPENED: "Đang mở",
  COMPLETED: '<span class="ok">Hoàn tất</span>',
  EXPIRED: '<span class="bad">Hết hạn</span>',
};

function sessionStatusCell(sessionId) {
  const result = sessionResults.get(sessionId);
  if (!result) return "—";
  const account = result.bankAccount
    ? `<br><small>${escape(result.bankAccount.bank.code)} ${escape(result.bankAccount.accountNumber)} · ${escape(result.bankAccount.status)}${result.bankAccount.deletedAt ? " · đã huỷ" : ""}</small>`
    : "";
  return `${SESSION_STATUS_LABEL[result.status] ?? escape(result.status)}${account}`;
}

async function loadSessions() {
  const items = await call("GET", "/api/sessions");
  $("#sessions").innerHTML = items
    .map(
      (s) => `<tr>
        <td>${date(s.createdAt)}</td>
        <td>${s.mode === "CONNECT" ? "Kết nối" : "Huỷ"}</td>
        <td>${escape(s.email ?? accountLabel(s.bankAccountId))}</td>
        <td><code>${escape(s.sessionId)}</code></td>
        <td data-session-status="${escape(s.sessionId)}">${sessionStatusCell(s.sessionId)}</td>
        <td><button class="small" data-check-session="${escape(s.sessionId)}">Tra cứu</button></td>
      </tr>`,
    )
    .join("");
}

async function checkSession(sessionId) {
  if (!sessionId) return;
  try {
    const result = await call("GET", `/api/connect-sessions/${sessionId}`);
    sessionResults.set(sessionId, result);
    log("GET /partner/connect-sessions/:id", { id: result.id, status: result.status, bankAccountId: result.bankAccountId });
    const cell = document.querySelector(`[data-session-status="${CSS.escape(sessionId)}"]`);
    if (cell) cell.innerHTML = sessionStatusCell(sessionId);
  } catch (err) {
    log("Lỗi tra phiên", err.message);
  }
}

async function loadBills() {
  const { data } = await call("GET", "/api/bills?status=PENDING");
  $("#bills").innerHTML = data
    .map(
      (b) => `<tr>
        <td>${b.batch?.status === "PENDING" ? "" : `<input type="checkbox" data-select-bill="${b.id}">`}</td>
        <td><code>${escape(b.code)}</code>${b.batch?.status === "PENDING" ? `<br><small>trong ${escape(b.batch.code)}</small>` : ""}</td>
        <td>${escape(b.bankAccount.bank.shortName)} ${escape(b.bankAccount.accountNumber)}<br><small>${escape(b.bankAccount.email)}</small></td>
        <td>${money(b.totalAmount)}</td>
        <td>${money(b.discountAmount)}</td>
        <td><strong>${money(b.amount)}</strong></td>
        <td>${b.planMonths} tháng</td>
        <td><div class="actions">
          ${
            b.batch?.status === "PENDING"
              ? "<small>Trả qua bill gộp</small>"
              : `<button class="small" data-bill="${b.id}">Xem QR</button>
          ${config.paymentSimulation ? `<button class="small" data-pay="${b.id}">Giả lập đã thanh toán</button>` : ""}`
          }
        </div></td>
      </tr>`,
    )
    .join("");
}

async function loadBatches() {
  const { data } = await call("GET", "/api/batch-orders?status=PENDING");
  $("#batches").innerHTML = data
    .map(
      (b) => `<tr>
        <td><code>${escape(b.code)}</code></td>
        <td>${b.billCount}</td>
        <td><strong>${money(b.amount)}</strong></td>
        <td>${date(b.createdAt)}</td>
        <td><div class="actions">
          <button class="small" data-batch="${b.id}">Xem QR</button>
          ${config.paymentSimulation ? `<button class="small" data-pay-batch="${b.id}">Giả lập đã thanh toán</button>` : ""}
          <button class="small danger" data-cancel-batch="${b.id}">Huỷ gộp</button>
        </div></td>
      </tr>`,
    )
    .join("");
}

async function loadWebhooks() {
  const items = await call("GET", "/api/webhooks");
  $("#webhooks").innerHTML = items
    .map((w) => {
      const sig = w.signatureValid === null ? "chưa cấu hình secret" : w.signatureValid ? "chữ ký hợp lệ" : "chữ ký SAI";
      const cls = w.signatureValid === false ? "bad" : "ok";
      return `<li>${date(w.receivedAt)} <span class="${cls}">[${sig}]</span> ${escape(JSON.stringify(w.payload))}</li>`;
    })
    .join("");
}

const loaders = {
  accounts: loadAccounts,
  bills: loadBills,
  batches: loadBatches,
  sessions: loadSessions,
  transactions: loadTransactions,
};

function showTab(name) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll(".panel")) {
    panel.hidden = panel.id !== `tab-${name}`;
  }
  try {
    history.replaceState(null, "", `#${name}`);
  } catch {}
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}
showTab(document.querySelector(`[data-tab="${location.hash.slice(1)}"]`) ? location.hash.slice(1) : "connect");

$("#transaction-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  loadTransactions().catch((err) => log("Lỗi tải", err.message));
});
$("#transaction-filter").addEventListener("reset", () => {
  selectedAccounts.clear();
  setTimeout(() => {
    renderAccountCombo();
    loadTransactions().catch((err) => log("Lỗi tải", err.message));
  });
});

$("#account-search").addEventListener("focus", () => toggleAccountList(true));
$("#account-search").addEventListener("input", () => {
  activeOption = 0;
  renderAccountCombo();
  toggleAccountList(true);
});
$("#account-search").addEventListener("keydown", (event) => {
  const options = filteredAccounts();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    toggleAccountList(true);
    const step = event.key === "ArrowDown" ? 1 : -1;
    activeOption = (activeOption + step + options.length) % Math.max(options.length, 1);
    renderAccountCombo();
    $("#account-options .active")?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    // Enter khi danh sách mở là chọn STK, không submit form lọc.
    if ($("#account-options").hidden || !options[activeOption]) return;
    event.preventDefault();
    toggleAccount(options[activeOption].id);
  } else if (event.key === "Escape") {
    toggleAccountList(false);
  } else if (event.key === "Backspace" && !event.target.value && selectedAccounts.size) {
    selectedAccounts.delete([...selectedAccounts].at(-1));
    renderAccountCombo();
  }
});
// mousedown thay vì click: giữ focus ở ô tìm kiếm để chọn liên tiếp nhiều STK.
$("#account-options").addEventListener("mousedown", (event) => {
  event.preventDefault();
  const li = event.target.closest("[data-account]");
  if (li) toggleAccount(li.dataset.account);
});
$("#account-chips").addEventListener("click", (event) => {
  const button = event.target.closest("[data-unselect]");
  if (button) toggleAccount(button.dataset.unselect);
});
document.addEventListener("click", (event) => {
  if (!$("#account-combo").contains(event.target)) toggleAccountList(false);
});

$("#expiry-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  loadAccounts().catch((err) => log("Lỗi tải", err.message));
});
$("#expiry-filter").addEventListener("reset", () => {
  setTimeout(() => loadAccounts().catch((err) => log("Lỗi tải", err.message)));
});

function showBill(bill) {
  const p = bill.payment;
  $("#bill-detail").innerHTML = p
    ? `<p>${bill.billCount ? `Bill gộp <code>${escape(bill.code)}</code> — ${bill.billCount} bill` : `Bill <code>${escape(bill.code)}</code> — ${bill.planMonths} tháng`}. Chuyển <strong>${money(p.amount)}đ</strong> tới ${escape(p.receiver?.bankName)} ${escape(p.receiver?.accountNumber)} (${escape(p.receiver?.accountName)}), nội dung <code>${escape(p.transferContent)}</code></p>${p.qrImageUrl ? `<img src="${escape(p.qrImageUrl)}" alt="VietQR">` : ""}`
    : "<p>Bill không còn chờ thanh toán.</p>";
  $("#bill-detail").scrollIntoView({ behavior: "smooth", block: "center" });
}

function reloadAll() {
  const fail = (err) => log("Lỗi tải", err.message);
  for (const load of [loadBills, loadBatches, loadSessions]) load().catch(fail);
  // Bảng giao dịch cần danh sách STK để hiện số tài khoản thay cho id.
  loadAccounts()
    .catch(fail)
    .finally(() => loadTransactions().catch(fail));
}

document.addEventListener("click", async (event) => {
  const el = event.target.closest("button");
  if (!el) return;
  try {
    if (el.dataset.reload) await loaders[el.dataset.reload]();
    const account = {
      bankCode: el.dataset.bank,
      accountNumber: el.dataset.accountNumber,
    };
    if (el.dataset.createBill) {
      const planId = await pickPlan(account, {
        title: "Tạo bill gia hạn",
        hint: "Gửi <code>POST /partner/bank-accounts/:id/bills</code> với <code>planId</code>. STK còn hạn thì trả xong hạn được cộng tiếp từ ngày hết hạn hiện tại. Đã có bill chờ cùng gói thì nhận lại bill đó; khác gói thì bill cũ tự huỷ.",
        okText: "Tạo bill",
      });
      if (!planId) return;
      const bill = await call("POST", `/api/bank-accounts/${el.dataset.createBill}/bills`, { planId });
      log("Đã tạo bill", { code: bill.code, amount: bill.amount, planMonths: bill.planMonths });
      reloadAll();
      showBill(bill);
    }
    if (el.dataset.simulate) {
      const input = await askSimulation(account);
      if (!input) return;
      const tx = await call("POST", `/api/bank-accounts/${el.dataset.simulate}/simulate-transaction`, input);
      log("Đã giả lập giao dịch", { id: tx.id, type: tx.type, amount: tx.amount, source: tx.source });
      loadTransactions().catch((err) => log("Lỗi tải", err.message));
      loadWebhooks().catch((err) => log("Lỗi tải", err.message));
    }
    if (el.dataset.disconnect) {
      const { linkToken, sessionId } = await call("POST", "/api/disconnect", { bankAccountId: el.dataset.disconnect });
      loadSessions().catch((err) => log("Lỗi tải", err.message));
      openWidget(linkToken, sessionId);
    }
    if (el.dataset.checkSession) {
      await checkSession(el.dataset.checkSession);
    }
    if (el.dataset.bill) {
      showBill(await call("GET", `/api/bills/${el.dataset.bill}`));
    }
    if (el.dataset.merge) {
      const billIds = [...document.querySelectorAll("[data-select-bill]:checked")].map((c) => c.dataset.selectBill);
      if (billIds.length < 2) throw new Error("Chọn ít nhất 2 bill để gộp");
      const batch = await call("POST", "/api/batch-orders", { billIds });
      log("Đã gộp bill", { code: batch.code, billCount: batch.billCount, amount: batch.amount });
      reloadAll();
      showBill(batch);
    }
    if (el.dataset.batch) {
      showBill(await call("GET", `/api/batch-orders/${el.dataset.batch}`));
    }
    if (el.dataset.payBatch) {
      await call("POST", `/api/batch-orders/${el.dataset.payBatch}/simulate-payment`);
      log("Đã giả lập thanh toán bill gộp", el.dataset.payBatch);
      reloadAll();
    }
    if (el.dataset.cancelBatch) {
      await call("DELETE", `/api/batch-orders/${el.dataset.cancelBatch}`);
      log("Đã huỷ bill gộp", el.dataset.cancelBatch);
      reloadAll();
    }
    if (el.dataset.pay) {
      await call("POST", `/api/bills/${el.dataset.pay}/simulate-payment`);
      log("Đã giả lập thanh toán", el.dataset.pay);
      reloadAll();
    }
  } catch (err) {
    log("Lỗi", err.message);
    alert(err.message);
  }
});

(async () => {
  config = await call("GET", "/api/config");
  $("#webhook-url").textContent = `${config.publicUrl}/webhook`;
  if (!config.hasToken) {
    $("#config-warning").hidden = false;
    $("#config-warning").textContent = "Chưa cấu hình GPMPAY_PARTNER_TOKEN trong .env.";
  }
  if (!window.GPMPayConnect) log("Lỗi", "Không tải được connect.js — kiểm tra WIDGET_SCRIPT_URL");
  loadBanks().catch((err) => log("Lỗi tải gói", err.message));
  reloadAll();
  loadWebhooks();
  setInterval(loadWebhooks, 3000);
})();
