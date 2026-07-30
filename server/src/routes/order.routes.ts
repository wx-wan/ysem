import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/order.controller";

const router = Router();
router.use(authenticate);

router.get("/", ctrl.list);
router.get("/customer/:customerId", ctrl.listByCustomer);
router.get("/:id", ctrl.getById);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
