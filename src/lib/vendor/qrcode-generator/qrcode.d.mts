declare function qrcode(typeNumber: 0, errorCorrectionLevel: "M"): {
  addData(value: string, mode: "Byte"): void;
  make(): void;
  createDataURL(cellSize: number, margin: number): string;
};
export default qrcode;
