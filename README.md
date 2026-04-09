# Auto LCR — Panduan Penggunaan

**Auto LCR** adalah ekstensi browser Chrome yang mengotomatiskan tiga aksi sekaligus pada konten Instagram dan TikTok:

- **Like** — menyukai postingan
- **Comment** — mengirim komentar dari kumpulan komentar yang sudah disiapkan
- **Repost** — membagikan ulang postingan

Setelah semua URL selesai diproses, ekstensi otomatis mengambil screenshot tiap halaman dan menyimpannya ke folder unduhan, lalu menghasilkan teks laporan yang siap disalin.

---

## Daftar Isi

1. [Persyaratan](#persyaratan)
2. [Instalasi](#instalasi)
3. [Struktur File](#struktur-file)
4. [Cara Penggunaan](#cara-penggunaan)
   - [Langkah 1 — Buka Popup Ekstensi](#langkah-1--buka-popup-ekstensi)
   - [Langkah 2 — Masukkan URL](#langkah-2--masukkan-url)
   - [Langkah 3 — Siapkan Comment Pool](#langkah-3--siapkan-comment-pool)
   - [Langkah 4 — Isi Info Laporan](#langkah-4--isi-info-laporan)
   - [Langkah 5 — Jalankan Automasi](#langkah-5--jalankan-automasi)
   - [Langkah 6 — Pantau Status Log](#langkah-6--pantau-status-log)
   - [Langkah 7 — Ambil Laporan](#langkah-7--ambil-laporan)
5. [Import dari Excel](#import-dari-excel)
6. [Screenshot Otomatis](#screenshot-otomatis)
7. [Menghentikan Automasi](#menghentikan-automasi)
8. [Troubleshooting](#troubleshooting)

---

## Persyaratan

| Kebutuhan      | Keterangan                                                                               |
| -------------- | ---------------------------------------------------------------------------------------- |
| Browser        | Google Chrome (atau browser berbasis Chromium seperti Edge, Brave)                       |
| Akun Instagram | Sudah login di tab browser yang sama                                                     |
| Akun TikTok    | Sudah login di tab browser yang sama                                                     |
| File SheetJS   | `xlsx.full.min.js` — diperlukan untuk fitur import Excel (lihat [Instalasi](#instalasi)) |

> **Penting:** Pastikan kamu sudah login ke Instagram dan TikTok di browser sebelum menjalankan automasi. Jika belum login, ekstensi akan mendeteksi halaman login dan mencatat URL tersebut sebagai error.

---

## Instalasi

### 1. Download atau Clone Repository

```
git clone <url-repository>
```

Atau download sebagai ZIP dan ekstrak ke folder pilihan kamu.

### 2. Load Ekstensi ke Chrome

1. Buka Chrome, pergi ke alamat: `chrome://extensions`
2. Aktifkan **Developer mode** (toggle di pojok kanan atas)
3. Klik tombol **Load unpacked**
4. Pilih folder `ext/` dari repository ini
5. Ekstensi **Auto LCR** akan muncul di daftar ekstensi

### 4. Pin Ekstensi (Opsional tapi Disarankan)

1. Klik ikon puzzle (🧩) di toolbar Chrome
2. Temukan **Auto LCR**
3. Klik ikon pin agar ekstensi selalu terlihat di toolbar

---

## Struktur File

```
ext/
├── manifest.json                  # Konfigurasi ekstensi
├── lib/
│   └── xlsx.full.min.js           # SheetJS (download manual)
└── src/
    ├── background/
    │   └── service_worker.js      # Engine utama automasi
    ├── content/
    │   ├── instagram.js           # Aksi di halaman Instagram
    │   └── tiktok.js              # Aksi di halaman TikTok
    └── popup/
        ├── popup.html             # Tampilan UI
        ├── popup.js               # Logika UI
        └── popup.css              # Styling
```

---

## Cara Penggunaan

### Langkah 1 — Buka Popup Ekstensi

Klik ikon **Auto LCR** (⚡) di toolbar Chrome. Popup akan terbuka sebagai jendela terpisah berukuran 460×720 px.

> Jika popup sudah terbuka sebelumnya, Chrome akan fokus ke jendela yang sudah ada daripada membuka jendela baru.

---

### Langkah 2 — Masukkan URL

Ada **dua cara** memasukkan URL yang akan diproses:

#### Cara A — Input Manual

Ketik atau tempel URL satu per baris di kotak **URL List**:

```
https://www.instagram.com/p/ABC123/
https://www.tiktok.com/@namauser/video/123456789
https://www.instagram.com/reel/XYZ789/
```

**URL yang didukung:**

- Instagram post: `instagram.com/p/...`
- Instagram reel: `instagram.com/reel/...` atau `instagram.com/reels/...`
- TikTok video: `tiktok.com/@user/video/...`

URL yang bukan Instagram atau TikTok akan dilewati secara otomatis (dicatat sebagai `skipped`).

#### Cara B — Import dari Excel

Lihat bagian [Import dari Excel](#import-dari-excel) untuk panduan lengkapnya.

---

### Langkah 3 — Siapkan Comment Pool

Isi kotak **Comment Pool** dengan komentar-komentar yang ingin digunakan, **satu komentar per baris**:

```
Konten yang sangat bagus!
Terus berkarya 🔥
Keren banget!
Mantap jiwa 👍
Luar biasa!
```

- Setiap URL akan mendapatkan **satu komentar dipilih secara acak** dari pool ini.
- Comment pool **tidak boleh kosong** — tombol Run akan ditolak jika kosong.
- Semakin banyak variasi komentar, semakin natural terlihatnya.

---

### Langkah 4 — Isi Info Laporan

Bagian **Info Laporan** digunakan untuk menghasilkan teks laporan setelah automasi selesai. Isi tiga field berikut:

| Field       | Contoh         | Keterangan                              |
| ----------- | -------------- | --------------------------------------- |
| **Nama**    | `Budi Santoso` | Nama operator yang menjalankan automasi |
| **Akun IG** | `@namaakun_ig` | Username akun Instagram yang digunakan  |
| **Akun TT** | `@namaakun_tt` | Username akun TikTok yang digunakan     |

> Field ini bersifat opsional — jika dikosongkan, laporan tetap dibuat dengan field tersebut kosong.

---

### Langkah 5 — Jalankan Automasi

Klik tombol **▶ Run**.

Ekstensi akan memproses URL satu per satu secara berurutan:

1. Membuka tab baru untuk URL tersebut
2. Menunggu halaman selesai dimuat
3. Melakukan **Like** → **Comment** → **Repost**
4. Menunggu 3 detik, lalu mengambil **screenshot**
5. Menyimpan screenshot ke folder unduhan
6. Menutup tab dan melanjutkan ke URL berikutnya

Terdapat **jeda acak 1–3 detik** di antara setiap aksi dan setiap URL untuk menghindari deteksi bot.

> **Jangan tutup popup** selama automasi berjalan. Jika popup ditutup secara tidak sengaja, kamu bisa membukanya kembali — progress yang sudah berjalan akan ditampilkan ulang dari session storage.

---

### Langkah 6 — Pantau Status Log

Bagian **Status Log** menampilkan progress secara real-time:

| Simbol                                 | Warna        | Keterangan                          |
| -------------------------------------- | ------------ | ----------------------------------- |
| `─── URL`                              | Abu-abu      | URL sedang diproses                 |
| `✓ Liked`                              | Hijau        | Like berhasil                       |
| `· Already liked — skipped`            | Abu-abu      | Post sudah pernah di-like, dilewati |
| `✓ Commented: "..."`                   | Hijau        | Komentar berhasil dikirim           |
| `✓ Reposted`                           | Hijau        | Repost berhasil                     |
| `📷 Screenshot saved`                  | Hijau        | Screenshot tersimpan                |
| `✗ ...`                                | Merah        | Terjadi error pada URL ini          |
| `↷ Skipped: ...`                       | Kuning       | URL dilewati (bukan IG/TikTok)      |
| `All done! ✓ X succeeded, ✗ Y failed.` | Hijau/Kuning | Semua selesai                       |

**Jika URL diimport dari Excel**, entri error akan ditampilkan sebagai:

```
✗ No. 5 / 2024-01-15 — detail error
```

**Jika URL diinput manual**, entri error ditampilkan sebagai:

```
✗ https://www.instagram.com/p/ABC123/ — detail error
```

Klik tombol **Clear** di pojok kanan atas log untuk membersihkan log.

---

### Langkah 7 — Ambil Laporan

Setelah automasi selesai (muncul pesan `All done!`), bagian **Laporan** akan otomatis muncul di bawah log.

Format laporan:

```
Budi Santoso / 001 / 2024-01-15
Budi Santoso / 002 / 2024-01-16
Budi Santoso / 003 / 2024-01-17

IG: @namaakun_ig
TT: @namaakun_tt
```

Klik tombol **Copy** untuk menyalin teks laporan ke clipboard, lalu tempel di mana saja (WhatsApp, email, spreadsheet, dll).

> Laporan hanya muncul jika URL diimport dari Excel. Untuk input URL manual, bagian laporan tidak ditampilkan.

---

## Import dari Excel

Fitur import Excel memungkinkan kamu mengimpor daftar URL langsung dari file tracker posting yang sudah ada.

### Format Excel yang Didukung

- Format file: **`.xlsx`** saja (bukan `.csv` atau `.xls`)
- Nama sheet: harus **`Data Posting`** (tidak case-sensitive)

### Struktur Kolom

Sheet harus memiliki baris header yang mengandung kata kunci berikut:

| Kolom           | Kata Kunci                       | Contoh                        |
| --------------- | -------------------------------- | ----------------------------- |
| No. Posting     | mengandung `no`                  | `No.`, `No. Posting`          |
| Tanggal Posting | mengandung `tanggal`             | `Tanggal`, `Tanggal Posting`  |
| Link Instagram  | mengandung `ig` atau `instagram` | `Link IG`, `Instagram`        |
| Link TikTok     | mengandung `tik` atau `tt`       | `Link TikTok`, `TikTok`, `TT` |

> Ekstensi mendeteksi kolom secara **dinamis** berdasarkan teks header, sehingga urutan kolom tidak perlu tepat sama — selama kata kunci ada di baris header.

### Contoh Format Excel

| No. | Tanggal Posting | Nama Konten | Link IG                          | Link TikTok                            |
| --- | --------------- | ----------- | -------------------------------- | -------------------------------------- |
| 001 | 2024-01-15      | Konten A    | https://www.instagram.com/p/AAA/ | https://www.tiktok.com/@user/video/111 |
| 002 | 2024-01-16      | Konten B    | https://www.instagram.com/p/BBB/ | https://www.tiktok.com/@user/video/222 |

### Aturan Import

- Hanya baris yang **kedua kolomnya** (IG dan TikTok) berisi URL valid `https://...` yang akan diimport.
- Baris dengan salah satu atau kedua link kosong akan **dilewati secara diam-diam**.
- Jika tidak ada baris valid sama sekali, URL list tidak akan diubah dan muncul pesan peringatan di log.
- Urutan URL yang dimasukkan ke URL List: **IG baris 1 → TikTok baris 1 → IG baris 2 → TikTok baris 2 → ...**

### Cara Import

1. Klik tombol **📂 Pilih File .xlsx**
2. Pilih file Excel dari file browser
3. Ekstensi akan membaca file dan mengisi URL List secara otomatis
4. Nama file dan jumlah baris yang berhasil diimport akan ditampilkan

---

## Screenshot Otomatis

Setelah setiap URL berhasil diproses, ekstensi otomatis mengambil screenshot halaman dan menyimpannya ke:

```
[Folder Unduhan Chrome]/auto-lcr-screenshots/screenshot-{platform}-{timestamp}.png
```

Contoh:

```
Downloads/
└── auto-lcr-screenshots/
    ├── screenshot-instagram.com-1705123456789.png
    ├── screenshot-tiktok.com-1705123457000.png
    └── ...
```

> Folder `auto-lcr-screenshots` akan dibuat otomatis di dalam folder unduhan default Chrome kamu.

---

## Menghentikan Automasi

Klik tombol **■ Stop** untuk menghentikan automasi.

- Automasi tidak berhenti langsung — ia akan **menyelesaikan URL yang sedang diproses** terlebih dahulu, baru berhenti.
- Setelah stop dikonfirmasi, muncul pesan `Automation stopped.` di log.
- URL-URL yang belum diproses akan diabaikan.

---

## Troubleshooting

### Error: "not logged in"

**Penyebab:** Kamu belum login ke Instagram atau TikTok.

**Solusi:** Buka Instagram/TikTok di tab Chrome yang sama dan pastikan sudah login, lalu coba jalankan kembali.

---

### Error: "Like button not found" / "Repost button not found"

**Penyebab:** Halaman belum selesai dimuat, atau Instagram/TikTok mengubah struktur DOM mereka.

**Solusi:**

- Pastikan koneksi internet stabil.
- Coba jalankan ulang URL tersebut satu per satu.
- Jika error terus terjadi secara konsisten, kemungkinan Instagram/TikTok memperbarui tampilan mereka — hubungi pengembang.

---

### Error: "Sheet 'Data Posting' tidak ditemukan"

**Penyebab:** Nama sheet di file Excel tidak sesuai.

**Solusi:** Buka file Excel, klik kanan nama sheet di bawah, pilih **Rename**, dan ganti menjadi `Data Posting`.

---

### Error: "Tidak ada baris valid ditemukan di Excel"

**Penyebab:** Tidak ada baris yang memiliki URL valid (diawali `https://`) di kedua kolom IG dan TikTok.

**Solusi:**

- Periksa kolom Link IG dan Link TikTok — pastikan berisi URL lengkap yang diawali `https://`.
- Pastikan header kolom mengandung kata kunci yang benar (`ig`/`instagram` dan `tik`/`tt`).

---

### Popup tiba-tiba tertutup saat automasi berjalan

**Penyebab:** Popup ekstensi ditutup secara tidak sengaja.

**Solusi:** Buka kembali popup dengan mengklik ikon ekstensi. Progress yang sudah berjalan akan ditampilkan ulang dari session storage. Automasi tetap berjalan di background selama tab Chrome tidak ditutup.

---

### Screenshot tidak tersimpan

**Penyebab:** Chrome memblokir download otomatis.

**Solusi:**

1. Buka `chrome://settings/content/automaticDownloads`
2. Tambahkan ekstensi ini ke daftar yang diizinkan, atau aktifkan **Izinkan semua situs menyimpan file secara otomatis**.

---

_© AZAMA. All rights reserved._
