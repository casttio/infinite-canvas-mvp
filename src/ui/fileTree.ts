const TREE_INDENT_BASE_REM = 0.4;
const TREE_INDENT_STEP_REM = 0.9;

export const getFileTreeIndent = (depth: number) => `${TREE_INDENT_BASE_REM + depth * TREE_INDENT_STEP_REM}rem`;
