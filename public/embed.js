(function () {
  var TUNDUK_URL = "https://tunduk-backend-production.up.railway.app";

  var btn = document.createElement("div");
  btn.innerHTML = "💬";
  btn.style.cssText =
    "position:fixed;bottom:20px;right:20px;width:58px;height:58px;border-radius:50%;" +
    "background:#C4402B;color:#fff;display:flex;align-items:center;justify-content:center;" +
    "font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);z-index:999999;" +
    "transition:transform 0.2s;";
  btn.onmouseenter = function () { btn.style.transform = "scale(1.08)"; };
  btn.onmouseleave = function () { btn.style.transform = "scale(1)"; };

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText =
    "position:fixed;bottom:90px;right:20px;width:370px;max-width:92vw;height:560px;" +
    "max-height:75vh;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.35);" +
    "display:none;z-index:999999;background:#14171F;";

  var iframe = document.createElement("iframe");
  iframe.src = TUNDUK_URL;
  iframe.style.cssText = "width:100%;height:100%;border:none;";
  frameWrap.appendChild(iframe);

  var open = false;
  btn.onclick = function () {
    open = !open;
    frameWrap.style.display = open ? "block" : "none";
    btn.innerHTML = open ? "✕" : "💬";
  };

  document.body.appendChild(frameWrap);
  document.body.appendChild(btn);
})();
