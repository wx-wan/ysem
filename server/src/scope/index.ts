/**
 * Scope / Permission 能力 —— Round R-5 · T2（D-P6-A）
 *
 * 由 `scope.ts` + `scope/deptTree.ts` 归位而来。
 * 本能力**需要 Data 访问**（DEPT 档位的部门树用户集合），因此**不能**留在 `utils/`
 *（shared 层禁止依赖业务层，见 check-layering 的 `R3-SHARED-BUSINESS`）。
 * 独立为顶级目录后，`check-layering` 将其归为 `unknown`，可合法依赖 `repositories/`。
 */
export * from './scope';
export * from './deptTree';
