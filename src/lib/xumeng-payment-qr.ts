import qrcode from "./vendor/qrcode-generator/qrcode.mjs";

/** Encode the exact provider-verified address, with a four-module quiet zone. */
export function paymentAddressQrDataUrl(address: string): string {
  if (!/^[A-Za-z0-9:_-]{20,128}$/.test(address)) throw new Error("付款地址格式无效。");
  const code = qrcode(0, "M");
  code.addData(address, "Byte"); code.make();
  return code.createDataURL(6, 24);
}
