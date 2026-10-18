const $ = (selector) => document.querySelector(selector);
let config = { sandbox: false };
let banks = [];

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

function openWidget(linkToken) {
  const options = displayOptions();
  if (options.container) $("#inline-section").scrollIntoView({ behavior: "smooth" });
  window.GPMPayConnect.open({
    ...options,
    token: linkToken,
    onSuccess: (result) => {
      log("onSuccess", result);
      $("#inline-section").hidden = true;
      reloadAll();
    },
    onExit: (exit) => {
      log("onExit", exit);
      $("#inline-section").hidden = true;
    },
    onEvent: (name, data) => log(`onEvent:${name}`, data),
  });
}

$("#connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const { linkToken } = await call("POST", "/api/connect", {
      email: form.get("email"),
      name: form.get("name"),
      phone: form.get("phone"),
      autoWebhook: form.get("autoWebhook") === "on",
    });
    openWidget(linkToken);
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
                <button class="small danger" data-disconnect="${a.id}">Huỷ kết nối</button>
              </div>`
        }</td>
      </tr>`,
    )
    .join("");
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

const loaders = { accounts: loadAccounts, bills: loadBills, batches: loadBatches };

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
  for (const load of Object.values(loaders)) load().catch((err) => log("Lỗi tải", err.message));
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
    if (el.dataset.disconnect) {
      const { linkToken } = await call("POST", "/api/disconnect", { bankAccountId: el.dataset.disconnect });
      openWidget(linkToken);
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
