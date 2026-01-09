declare module "tree-kill" {
  type Signal = NodeJS.Signals | number;
  function treeKill(
    pid: number,
    signal?: Signal,
    callback?: (err?: Error) => void,
  ): void;
  export default treeKill;
}
