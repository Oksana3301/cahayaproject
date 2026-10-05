// ===== app.js bersama =====
(function () {
  "use strict";

  var MENU = [
    { grup: "UTAMA", butir: [
      { label: "Ruang Rapat", jalur: "/", warna: "#c6f24d" },
      { label: "Persetujuan", jalur: "/persetujuan", warna: "#7b68ee" },
    ]},
    { grup: "RISET", butir: [
      { label: "Riset Konten", jalur: "/riset", warna: "#8fb7ff" },
      { label: "Tren & Musik", jalur: "/tren", warna: "#e5c07b" },
    ]},
    { grup: "KONTEN", butir: [
      { label: "Draft", jalur: "/draft", warna: "#c6f24d" },
      { label: "Jadwal Terbit", jalur: "/jadwal", warna: "#8fb7ff" },
    ]},
    { grup: "PASUKAN", butir: [
      { label: "Pasukan", jalur: "/pasukan", warna: "#7b68ee" },
      { label: "Kantor 3D", jalur: "/kantor", warna: "#e5c07b" },
    ]},
    { grup: "SISTEM", butir: [
      { label: "Biaya & Jatah", jalur: "/biaya", warna: "#c6f24d" },
      { label: "Jejak Keputusan", jalur: "/jejak", warna: "#8fb7ff" },
      { label: "Pengaturan", jalur: "/pengaturan", warna: "#8c92a0" },
    ]},
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function umurLalu(ts) {
    if (!ts) return "-";
    var d = new Date(ts);
    var selisih = (Date.now() - d.getTime()) / 1000;
    if (selisih < 60) return Math.floor(selisih) + " detik lalu";
    if (selisih < 3600) return Math.floor(selisih / 60) + " menit lalu";
    if (selisih < 86400) return Math.floor(selisih / 3600) + " jam lalu";
    return Math.floor(selisih / 86400) + " hari lalu";
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { window.location.href = "/masuk"; throw new Error("belum masuk"); }
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      });
    });
  }

  function tampilkanError(el, pesan) {
    if (!el) return;
    el.textContent = pesan;
    el.hidden = false;
  }

  function statusBadge(status) {
    var warna = {
      menunggu: "#8c92a0", dikerjakan: "#8fb7ff", selesai: "#c6f24d",
      gagal: "#c84646", perlu_persetujuan: "#e5c07b",
      ditolak: "#c84646", terjadwal: "#8fb7ff", terbit: "#c6f24d",
      idle: "#8c92a0", jalan: "#8fb7ff", kerja: "#c6f24d", rapat: "#7b68ee",
    };
    var c = warna[status] || "#8c92a0";
    return '<span style="color:' + c + '">' + esc(status) + "</span>";
  }

  function bangunMenu(jalurAktif) {
    var html = "";
    for (var i = 0; i < MENU.length; i++) {
      html += '<div class="grup-menu"><div class="judul-grup">' + esc(MENU[i].grup) + "</div>";
      for (var j = 0; j < MENU[i].butir.length; j++) {
        var b = MENU[i].butir[j];
        var cls = b.jalur === jalurAktif ? "butir-menu aktif" : "butir-menu";
        html += '<a href="' + b.jalur + '" class="' + cls + '">' +
          '<span class="kotak-warna" style="background:' + b.warna + '"></span>' +
          esc(b.label) + "</a>";
      }
      html += "</div>";
    }
    return html;
  }

  function bangunIndikator(status) {
    var rem = status && status.rem_tangan;
    var dot = rem ? "titik-indikator merah" : "titik-indikator";
    var teks = rem ? "Rem tangan aktif" : "Heartbeat jalan";
    return '<div class="indikator"><span class="' + dot + '"></span>' + esc(teks) + "</div>";
  }

  function muatLayout(jalurAktif, isiHtml, judul) {
    var body = document.body;
    body.innerHTML =
      '<div class="layout">' +
      '<aside class="menu-samping" id="menu-samping">' +
      bangunMenu(jalurAktif) +
      '<div class="bawah-menu">' +
      '<div class="nama-bisnis">Cahaya Project</div>' +
      '<div id="indikator-status"></div>' +
      '<button class="tombol tombol-biasa tombol-keluar" id="tombol-keluar">Keluar</button>' +
      "</div></aside>" +
      '<main class="isi-halaman">' +
      '<h1 class="judul-halaman">' + esc(judul) + "</h1>" +
      isiHtml +
      "</main></div>";

    document.getElementById("tombol-keluar").addEventListener("click", function () {
      fetchJson("/api/keluar", { method: "POST" })
        .then(function () { window.location.href = "/masuk"; })
        .catch(function () { window.location.href = "/masuk"; });
    });

    fetchJson("/api/status").then(function (s) {
      var el = document.getElementById("indikator-status");
      if (el) el.innerHTML = bangunIndikator(s);
    }).catch(function () {});
  }

  window.Util = {
    esc: esc, umurLalu: umurLalu, fetchJson: fetchJson,
    tampilkanError: tampilkanError, statusBadge: statusBadge,
    muatLayout: muatLayout, bangunMenu: bangunMenu,
  };
})();
