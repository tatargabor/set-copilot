/**
 * The `text` render's DOM builder — the impure half of the wall's formatter.
 *
 * Split out of `wall.js` so the same code the wall runs can be loaded by a static harness
 * (the live wall holds an SSE connection open, so a headless browser never settles on it
 * and cannot screenshot it — verifying a copy would verify nothing).
 *
 * The rule this file exists to keep: `createElement` + `textContent` ONLY. No `innerHTML`,
 * no `insertAdjacentHTML`, no template string carrying event content. The tokenizer in
 * `text-format.mjs` has no node type representing markup, so there is nothing here that
 * could pass any through — that absence IS the invariant, and a test greps for it.
 */

/**
 * Turn the tokenizer's inline nodes into elements.
 *
 * `createElement` + text nodes ONLY — never `innerHTML`, never a template string carrying
 * event content. The tokenizer has no node type representing markup, so there is nothing
 * here that could pass any through; that absence is the invariant, and a test greps this
 * file to keep it. See `text-format.mjs`.
 */
export function appendInline(parent, nodes) {
  for (const n of nodes) {
    if (n.type === "text") { parent.appendChild(document.createTextNode(n.value)); continue; }
    if (n.type === "code") {
      const c = document.createElement("code");
      c.className = "ic";
      c.textContent = n.value;
      parent.appendChild(c);
      continue;
    }
    const e = document.createElement(n.type === "bold" ? "strong" : "em");
    appendInline(e, n.children);
    parent.appendChild(e);
  }
}

/** Turn the tokenizer's block nodes into elements. Same rule as `appendInline`. */
export function appendBlocks(parent, blocks) {
  for (const b of blocks) {
    if (b.type === "paragraph") {
      const p = document.createElement("p");
      p.className = "p";
      appendInline(p, b.children);
      parent.appendChild(p);
      continue;
    }
    if (b.type === "codeblock") {
      const pre = document.createElement("pre");
      pre.className = "cb";
      if (b.lang) pre.dataset.lang = b.lang;
      const code = document.createElement("code");
      code.textContent = b.value;
      pre.appendChild(code);
      parent.appendChild(pre);
      continue;
    }
    if (b.type === "bullets" || b.type === "numbers") {
      const list = document.createElement(b.type === "bullets" ? "ul" : "ol");
      for (const item of b.items) {
        const li = document.createElement("li");
        appendInline(li, item);
        list.appendChild(li);
      }
      parent.appendChild(list);
      continue;
    }
    if (b.type === "table") {
      // A real <table>: column alignment is the browser's job. The operator's complaint
      // was specifically about a CHARACTER-drawn table arriving as run-on text.
      const wrap = document.createElement("div");
      wrap.className = "tbl-wrap"; // owns the horizontal overflow, so a wide table
      const table = document.createElement("table"); // never reshapes the layout (D4)
      table.className = "tbl";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      b.header.forEach((cell, i) => {
        const th = document.createElement("th");
        th.style.textAlign = b.align[i] ?? "left";
        appendInline(th, cell);
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const row of b.rows) {
        const tr = document.createElement("tr");
        row.forEach((cell, i) => {
          const td = document.createElement("td");
          td.style.textAlign = b.align[i] ?? "left";
          appendInline(td, cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      parent.appendChild(wrap);
    }
  }
}

