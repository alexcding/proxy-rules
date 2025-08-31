// reddit.js
// 用途：在 http-response 阶段清理微博返回 JSON 中的广告与 NSFW 弹窗标记
// 规范：严格按 Surge 手册使用 $done({ body / headers / status }) 输出结果

(function () {
  // 若无 body，保持原样
  if (!$response || typeof $response.body !== "string") {
    return $done({});
  }

  const raw = $response.body.trim();
  // 非 JSON（例如 HTML 或空响应）则不处理
  if (!raw || (raw[0] !== "{" && raw[0] !== "[")) {
    return $done({});
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // 解析失败则不修改
    return $done({});
  }

  const cleaned = cleanWeiboData(data);

  // 可选：若原响应未带 Content-Type，则补上（手册允许改 headers）
  // 注意：某些头部（如 Content-Length）可能被忽略，交由 Surge 处理
  // 参考：manual.nssurge.com/scripting/http-response.html
  const headers = $response.headers || {};
  const hasCT = Object.keys(headers).some(k => k.toLowerCase() === "content-type");
  if (!hasCT) headers["Content-Type"] = "application/json; charset=utf-8";

  // 输出：只要改了 body/headers/status 都必须通过 $done({...})
  return $done({
    body: JSON.stringify(cleaned),
    // headers, // 如需强制写回响应头，解除本行注释
    // status: 200 // 如需变更状态码，可设置
  });

  // —— 递归清理逻辑 —— //
  function cleanWeiboData(input) {
    return walk(input);

    function walk(node) {
      if (Array.isArray(node)) {
        // 递归并过滤 undefined（表示已删除的元素）
        return node.map(walk).filter(v => v !== undefined);
      }
      if (node && typeof node === "object") {
        const obj = { ...node };

        // 1) NSFW 标志位：关闭限制、允许展示
        if (obj.isNsfw === true) obj.isNsfw = false;
        if (obj.isNsfwMediaBlocked === true) obj.isNsfwMediaBlocked = false;
        if (obj.isNsfwContentShown === false) obj.isNsfwContentShown = true;

        // 2) 清空评论区广告数组
        if (Array.isArray(obj.commentsPageAds)) obj.commentsPageAds = [];

        // 3) 命中广告特征的节点整体删除（返回 undefined）
        // 3.1 node.cells 含 AdMetadataCell 或 isAdPost=true
        if (
          obj.node &&
          typeof obj.node === "object" &&
          Array.isArray(obj.node.cells) &&
          obj.node.cells.some(
            c =>
              (c && typeof c === "object" && c.__typename === "AdMetadataCell") ||
              (c && c.isAdPost === true)
          )
        ) {
          return undefined;
        }
        // 3.2 存在 node.adPayload
        if (obj.node && typeof obj.node === "object" && typeof obj.node.adPayload === "object") {
          return undefined;
        }
        // 3.3 自身就是广告类型
        if (obj.__typename === "AdPost") {
          return undefined;
        }

        // 4) 递归其余子键；若子值为 undefined，则删除该键
        for (const k of Object.keys(obj)) {
          const v = walk(obj[k]);
          if (v === undefined) delete obj[k];
          else obj[k] = v;
        }
        return obj;
      }
      // 基本类型原样返回
      return node;
    }
  }
})();