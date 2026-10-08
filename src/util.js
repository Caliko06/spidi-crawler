// Odds and ends more than one module of the reader needs.

export const clamp = (value, least, most) => Math.min(Math.max(value, least), most);
// A value at random between the two of `[least, most]`.
export const between = ([least, most]) => least + Math.random() * (most - least);
export const two = (count) => String(count).padStart(2, '0');
