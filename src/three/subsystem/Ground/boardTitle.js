import { createCSS2DObject } from "../../../lib/CSSObject";

export const createBuildingNameLabel = (
  innerText,
  onSingleClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave
) => {
  const labelEleOut = document.createElement("div");
  labelEleOut.draggable = false;
  labelEleOut.className = "building-name-board";

  const labelEle = document.createElement("div");
  labelEle.className = "building-name-board__text";
  labelEle.innerText = innerText ?? "";

  const labelTop = document.createElement("div");
  labelTop.className = "building-name-board__top";

  const labelBottom = document.createElement("div");
  labelBottom.className = "building-name-board__bottom";

  const labelArrow = document.createElement("div");
  labelArrow.className = "building-name-board__arrow";

  labelEle.append(labelTop, labelBottom);
  labelEleOut.append(labelEle, labelArrow);

  const css2d = createCSS2DObject(labelEleOut);
  // 锚点落在牌子底部箭头尖端，保证箭头指向建筑顶部
  css2d.center.set(0.5, 0);

  let clickTimer = null;
  const bindTarget = labelEleOut;
  bindTarget.onclick = (e) => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickTimer = setTimeout(() => {
      if (onSingleClick) onSingleClick(css2d, e);
      clickTimer = null;
    }, 250);
  };
  bindTarget.ondblclick = (e) => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    if (onDoubleClick) onDoubleClick(css2d, e);
  };

  if (onMouseEnter) {
    bindTarget.onmouseenter = (e) => {
      onMouseEnter(css2d, e);
    };
  }
  if (onMouseLeave) {
    bindTarget.onmouseleave = (e) => {
      onMouseLeave(css2d, e);
    };
  }

  return css2d;
};

export const createBuildingInfoLabel = (innerText, visible = false) => {
  let labelEle = document.createElement("div");
  let labelEleOut = document.createElement("div");
  labelEleOut.append(labelEle);
  labelEleOut.draggable = false;
  labelEleOut.className = "buildingNum";
  labelEle.innerText = innerText;
  let css2d = createCSS2DObject(labelEleOut);
  css2d.visible = visible;

  return css2d;
};
