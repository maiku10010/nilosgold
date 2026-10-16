"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundTwo = roundTwo;
/** Round parsed decimal values to cents, including halfway values such as 1.005. */
function roundTwo(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return number;
    const [coefficient, exponent = "0"] = String(Math.abs(number)).split("e");
    const shifted = Number(`${coefficient}e${Number(exponent) + 2}`);
    if (!Number.isFinite(shifted))
        return number;
    return Math.sign(number) * Math.round(shifted) / 100;
}
