import createElement from "/vendor/lucide/dist/esm/createElement.mjs";
import ArrowDown from "/vendor/lucide/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "/vendor/lucide/dist/esm/icons/arrow-up.mjs";
import AtSign from "/vendor/lucide/dist/esm/icons/at-sign.mjs";
import Blocks from "/vendor/lucide/dist/esm/icons/blocks.mjs";
import ChevronDown from "/vendor/lucide/dist/esm/icons/chevron-down.mjs";
import ChevronLeft from "/vendor/lucide/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "/vendor/lucide/dist/esm/icons/chevron-right.mjs";
import Copy from "/vendor/lucide/dist/esm/icons/copy.mjs";
import GitBranch from "/vendor/lucide/dist/esm/icons/git-branch.mjs";
import GitCompare from "/vendor/lucide/dist/esm/icons/git-compare.mjs";
import MessageSquare from "/vendor/lucide/dist/esm/icons/message-square.mjs";
import PanelLeft from "/vendor/lucide/dist/esm/icons/panel-left.mjs";
import PanelRight from "/vendor/lucide/dist/esm/icons/panel-right.mjs";
import Paperclip from "/vendor/lucide/dist/esm/icons/paperclip.mjs";
import RefreshCw from "/vendor/lucide/dist/esm/icons/refresh-cw.mjs";
import Search from "/vendor/lucide/dist/esm/icons/search.mjs";
import SlidersHorizontal from "/vendor/lucide/dist/esm/icons/sliders-horizontal.mjs";
import Square from "/vendor/lucide/dist/esm/icons/square.mjs";
import SquarePen from "/vendor/lucide/dist/esm/icons/square-pen.mjs";
import TerminalSquare from "/vendor/lucide/dist/esm/icons/square-terminal.mjs";
import X from "/vendor/lucide/dist/esm/icons/x.mjs";

const ICONS = {
  "arrow-down": ArrowDown,
  "arrow-up": ArrowUp,
  "at-sign": AtSign,
  blocks: Blocks,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  copy: Copy,
  "git-branch": GitBranch,
  "git-compare": GitCompare,
  "message-square": MessageSquare,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  paperclip: Paperclip,
  "refresh-cw": RefreshCw,
  search: Search,
  "sliders-horizontal": SlidersHorizontal,
  square: Square,
  "square-pen": SquarePen,
  "terminal-square": TerminalSquare,
  x: X,
};

export function renderIcons(root = document) {
  for (const node of root.querySelectorAll("[data-icon]")) {
    const icon = ICONS[node.dataset.icon];
    if (!icon) continue;
    node.replaceWith(createElement(icon, { "aria-hidden": "true" }));
  }
}
