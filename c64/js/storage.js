/* storage.js - LOAD/SAVE ueber den Browser: localStorage ("Diskette", Geraet 8) und
   Datei-Download/-Dialog ("Datasette", Geraet 1). Binaerdaten immer als Base64. */
(function (C64) {
  'use strict';
  const PREFIX = 'c64disk:';
  const hasLS = (() => { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; } })();
  const fallback = new Map();

  const S = {
    toBase64(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    fromBase64(text) {
      const s = atob(text.replace(/\s+/g, ''));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
    /* Dateiinhalt: Base64-Text oder rohe Binaerdaten */
    decodeFile(bytes) {
      let text = '';
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (!(c === 43 || c === 47 || c === 61 || c === 10 || c === 13 || c === 32 ||
          (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return bytes;
        text += String.fromCharCode(c);
      }
      try { const d = S.fromBase64(text); return d.length >= 2 ? d : bytes; } catch (e) { return bytes; }
    },

    // ---- "Diskette" im localStorage ----
    keys() {
      const out = [];
      if (hasLS) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.indexOf(PREFIX) === 0) out.push(k.substr(PREFIX.length));
        }
      } else for (const k of fallback.keys()) out.push(k);
      return out.sort();
    },
    put(name, bytes) {
      const v = S.toBase64(bytes);
      if (hasLS) localStorage.setItem(PREFIX + name, v); else fallback.set(name, v);
    },
    get(name) {
      const v = hasLS ? localStorage.getItem(PREFIX + name) : fallback.get(name);
      return v == null ? null : S.fromBase64(v);
    },
    remove(name) { if (hasLS) localStorage.removeItem(PREFIX + name); else fallback.delete(name); },
    /* Namenssuche mit * und ? */
    find(pattern) {
      const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*.*$/, '.*').replace(/\?/g, '.') + '$');
      return S.keys().find((k) => re.test(k)) || null;
    },
    /* Verzeichnis als BASIC-Programm (wie LOAD"$",8) */
    directory() {
      const out = [0x01, 0x04];
      let addr = 0x0401;
      const line = (num, text) => {
        addr += text.length + 5;
        out.push(addr & 0xFF, addr >> 8, num & 0xFF, num >> 8);
        for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
        out.push(0);
      };
      line(0, '\x12"BROWSER DISK    " LS 2A');
      let used = 0;
      for (const k of S.keys()) {
        const len = S.get(k).length, blocks = Math.max(1, Math.ceil(len / 254));
        used += blocks;
        const pad = blocks < 10 ? '   ' : blocks < 100 ? '  ' : ' ';
        line(blocks, pad + ('"' + k + '"').padEnd(18, ' ') + ' PRG');
      }
      line(Math.max(0, 664 - used), 'BLOCKS FREE.');
      out.push(0, 0);
      return new Uint8Array(out);
    },

    // ---- "Datasette": Dateien des Betriebssystems ----
    download(name, bytes) {
      if (typeof document === 'undefined') return;
      const blob = new Blob([S.toBase64(bytes)], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (name || 'PROGRAM') + '.prg.b64';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    /* Datei-Dialog; liefert Promise<{name, bytes} | null> */
    upload() {
      return new Promise((resolve) => {
        if (typeof document === 'undefined') { resolve(null); return; }
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.prg,.b64,.txt,.bin,.seq';
        inp.style.display = 'none';
        let done = false;
        const finish = (v) => { if (!done) { done = true; inp.remove(); resolve(v); } };
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) { finish(null); return; }
          S.readFile(f).then(finish, () => finish(null));
        });
        inp.addEventListener('cancel', () => finish(null));
        window.addEventListener('focus', () => setTimeout(() => { if (!inp.files || !inp.files.length) finish(null); }, 1500), { once: true });
        document.body.appendChild(inp);
        inp.click();
      });
    },
    readFile(file) {
      return file.arrayBuffer().then((buf) => ({
        name: file.name.replace(/\.(prg|b64|txt|bin|seq)$/gi, '').replace(/\.(prg)$/i, '').toUpperCase(),
        bytes: S.decodeFile(new Uint8Array(buf))
      }));
    }
  };

  C64.storage = S;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
