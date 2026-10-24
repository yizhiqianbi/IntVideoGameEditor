import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import qrModule from "./xumeng-payment-qr";
const { paymentAddressQrDataUrl } = qrModule as typeof import("./xumeng-payment-qr");

test("payment QR independently decodes to exactly the original address, including a quiet zone", () => {
  for (const address of ["T" + "B".repeat(33), "0x" + "1234567890abcdef".repeat(2) + "12345678", "aB7".repeat(40)]) {
    const dataUrl = paymentAddressQrDataUrl(address);
    assert.ok(dataUrl.startsWith("data:image/gif;base64,"));
    const result = spawnSync("python3", ["-c", "import sys,io,base64; from PIL import Image; import cv2,numpy as np; im=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read()))).convert('RGB'); print(cv2.QRCodeDetector().detectAndDecode(np.array(im))[0])"],
      { input: dataUrl.split(",")[1], encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), address);
  }
  for (const bad of ["", "short", "https://example.invalid/a?key=test", "T" + "B".repeat(129), "T\n" + "B".repeat(33)]) {
    assert.throws(() => paymentAddressQrDataUrl(bad));
  }
});
