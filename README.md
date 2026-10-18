# GPMPay Widget connect — đối tác mẫu

Một "phần mềm bán hàng" giả lập, nhúng widget GPMPay để người dùng kết nối tài
khoản ngân hàng **ngay trên trang của đối tác**, không phải sang GPMPay. Dùng để:

- kiểm thử đầu-cuối widget trên sandbox,
- demo cho đối tác,
- làm code mẫu tích hợp: Express + HTML tĩnh, không framework, chép sang stack nào cũng được.

API token đối tác chỉ nằm ở server (`server.js`), không bao giờ xuống trình duyệt —
đối tác thật cũng phải làm như vậy.

## Luồng

```
Trình duyệt ── POST /api/connect ──> server.js ── POST /partner/connect-sessions ──> GPMPay
            <──────── linkToken ─────────────────────────────────────────────────────
GPMPayConnect.open({ token }) → iframe widget-connect.gpmpay.com → OTP → onSuccess
GPMPay ── POST /webhook (ký HMAC, header X-GPMPay-Signature) ──> server.js
```

## Chuẩn bị

1. Đăng nhập (sandbox: `sandbox-app.gpmpay.com` hoặc prod: `app.gpmpay.com`) bằng tài khoản sẽ làm chủ đối tác, tạo một **OAuth App** cho nền tảng (OAuth Apps → Tạo).
2. Gửi thông tin Oauth2 app + domain cho admin GPMPay để cấu hình.
3. Vào **API tokens** → Thêm, chọn **Nền tảng (Widget connect)** là app trên, tick
   đủ 4 scope `partner:connect`, `partner:accounts:read`, `partner:billing`,
   `partner:webhooks`. Sao chép token `gpm_...`.

## Chạy local

```bash
cp .env.example .env   # điền GPMPAY_PARTNER_TOKEN, WEBHOOK_SECRET
npm install
npm run dev            # http://localhost:4000
```

- Webhook tự tạo cần GPMPay gọi được vào `PUBLIC_URL/webhook`. GPMPay chặn địa
  chỉ nội bộ, nên khi chạy local hãy **bỏ tick "Tạo webhook tự động"**, hoặc mở
  tunnel (`cloudflared tunnel --url http://localhost:4000`) rồi đặt `PUBLIC_URL`
  là URL tunnel và khai URL đó vào `allowedOrigins`.
- OTP test: Liên hệ admin GPMPay

## Trang demo có gì

Trang chia 4 tab (tab đang mở được nhớ trên URL, ví dụ `#billing`):

1. **Kết nối**
   - Nhập email/tên/SĐT → server tạo phiên (`POST /partner/connect-sessions`) → mở widget. Trong widget người dùng chọn
     ngân hàng và loại tài khoản (cá nhân / hộ kinh doanh / doanh nghiệp), nhập thông tin rồi xác thực OTP.
   - Kết nối không tạo bill. STK đủ điều kiện dùng thử được cấp hạn dùng thử;
     STK còn lại chưa có hạn cho tới khi đối tác tạo bill gia hạn và thanh toán.
   - **Nhật ký callback**: `onSuccess`, `onExit`, `onEvent` theo thời gian thực.
2. **Tài khoản ngân hàng** (`GET /partner/bank-accounts`)
   - Lọc **"Hết hạn trước hoặc trong ngày"** (`expiresBefore`): STK sắp hết hạn tới ngày chọn, kể cả STK đã hết hạn, sắp theo hạn — để chủ động gia hạn.
   - Mỗi STK: **tạo bill gia hạn** (hộp chọn gói của đúng ngân hàng STK, gửi
     `planId` tới `POST /partner/bank-accounts/:id/bills`, hiện luôn QR), huỷ kết nối (mở widget ở chế độ huỷ).
3. **Thanh toán**
   - **Bill đang chờ** (`GET /partner/bills`): số tiền, giảm giá, mã
     `GPAY######`, QR chuyển khoản.
     Tick nhiều bill rồi bấm **Gộp bill đã chọn** để tạo bill gộp (`POST /partner/batch-orders`, 2–200 bill).
   - **Bill gộp đang chờ** (`GET /partner/batch-orders`): mã `GPAYB######`, số
     bill, tổng tiền, QR chuyển khoản một lần cho cả nhóm, nút giả lập thanh
     toán và huỷ gộp (bill con trở lại bill lẻ). Bill con trong bill gộp đang
     chờ không trả lẻ được.
4. **Webhook**: payload `POST /webhook` của demo nhận được, kèm kết quả kiểm chữ
   ký.

## Nhúng widget vào trang của bạn

```html
<script src="https://sandbox-widget-connect.gpmpay.com/v1/connect.js"></script>
<script>
  GPMPayConnect.open({
    token: linkToken, // lấy từ server của bạn
    onSuccess: ({ bankAccountId, status, trial, disconnected }) => {},
    onExit: ({ reason }) => {}, // user_closed | contact_admin | invalid_token | error
    onEvent: (name, data) => {},
  });
</script>
```

`connect.js` tải từ host nào thì mở widget ở host đó (prod: `https://widget-connect.gpmpay.com/v1/connect.js`).

Tuỳ chọn (không bắt buộc): `container` (nhúng thẳng vào trang thay cho popup,
iframe tự đổi chiều cao), `popup: { width, height }`, và
`appearance: { fontFamily, fontUrl, fontSize }` (`fontUrl` chỉ nhận Google
Fonts). Ở tab Kết nối của demo có khung "Hiển thị widget" để thử các tuỳ chọn này.
