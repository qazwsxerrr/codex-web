import createElement from "/vendor/lucide/dist/esm/createElement.mjs";
import ArrowDown from "/vendor/lucide/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "/vendor/lucide/dist/esm/icons/arrow-up.mjs";
import AtSign from "/vendor/lucide/dist/esm/icons/at-sign.mjs";
import ChevronDown from "/vendor/lucide/dist/esm/icons/chevron-down.mjs";
import ChevronLeft from "/vendor/lucide/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "/vendor/lucide/dist/esm/icons/chevron-right.mjs";
import Check from "/vendor/lucide/dist/esm/icons/check.mjs";
import Copy from "/vendor/lucide/dist/esm/icons/copy.mjs";
import File from "/vendor/lucide/dist/esm/icons/file.mjs";
import FileCode from "/vendor/lucide/dist/esm/icons/file-code.mjs";
import Folder from "/vendor/lucide/dist/esm/icons/folder.mjs";
import FolderOpen from "/vendor/lucide/dist/esm/icons/folder-open.mjs";
import GitBranch from "/vendor/lucide/dist/esm/icons/git-branch.mjs";
import GitCompare from "/vendor/lucide/dist/esm/icons/git-compare.mjs";
import MessageSquare from "/vendor/lucide/dist/esm/icons/message-square.mjs";
import PanelLeft from "/vendor/lucide/dist/esm/icons/panel-left.mjs";
import PanelRight from "/vendor/lucide/dist/esm/icons/panel-right.mjs";
import PanelRightOpen from "/vendor/lucide/dist/esm/icons/panel-right-open.mjs";
import Paperclip from "/vendor/lucide/dist/esm/icons/paperclip.mjs";
import Play from "/vendor/lucide/dist/esm/icons/play.mjs";
import Plus from "/vendor/lucide/dist/esm/icons/plus.mjs";
import RefreshCw from "/vendor/lucide/dist/esm/icons/refresh-cw.mjs";
import Search from "/vendor/lucide/dist/esm/icons/search.mjs";
import SlidersHorizontal from "/vendor/lucide/dist/esm/icons/sliders-horizontal.mjs";
import Square from "/vendor/lucide/dist/esm/icons/square.mjs";
import TerminalSquare from "/vendor/lucide/dist/esm/icons/square-terminal.mjs";
import Trash2 from "/vendor/lucide/dist/esm/icons/trash-2.mjs";
import X from "/vendor/lucide/dist/esm/icons/x.mjs";

const ICONS = {
  "arrow-down": ArrowDown,
  "arrow-up": ArrowUp,
  "at-sign": AtSign,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  check: Check,
  copy: Copy,
  file: File,
  "file-code": FileCode,
  folder: Folder,
  "folder-open": FolderOpen,
  "git-branch": GitBranch,
  "git-compare": GitCompare,
  "message-square": MessageSquare,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  "panel-right-open": PanelRightOpen,
  paperclip: Paperclip,
  play: Play,
  plus: Plus,
  "refresh-cw": RefreshCw,
  search: Search,
  "sliders-horizontal": SlidersHorizontal,
  square: Square,
  "terminal-square": TerminalSquare,
  "trash-2": Trash2,
  x: X,
};

export function renderIcons(root = document) {
  for (const node of root.querySelectorAll("[data-icon]")) {
    const icon = ICONS[node.dataset.icon];
    if (!icon) continue;
    node.replaceWith(createElement(icon, { "aria-hidden": "true" }));
  }
}
