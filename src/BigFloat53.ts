// This file is part of bigfloat, copyright (c) 2018- BusFaster Ltd.
// Released under the MIT license, see LICENSE.

/*
	These algorithms are based on the paper:
	Adaptive Precision Floating-Point Arithmetic and Fast Robust Geometric Predicates
	Jonathan Richard Shewchuk
	Discrete & Computational Geometry 18(3):305–363, October 1997.
*/

import { BigFloat32 } from './BigFloat32';

export const dekkerSplitter = (1 << 27) + 1;
export const limbsPerDigit53 = Math.log(10) / (53 * Math.log(2));

/** See Shewchuk page 7. */

/*
function fastTwoSum(a: number, b: number, sum: number[]) {
	const estimate = a + b;

	sum[0] = b - (estimate - a);
	sum[1] = estimate;

	return(sum);
}
*/

/** Error-free addition of two floating point numbers.
  * See Shewchuk page 8. Note that output order is swapped! */

function twoSum(a: number, b: number, sum: number[]) {
	const estimate = a + b;
	const b2 = estimate - a;
	const a2 = estimate - b2;

	sum[0] = (a - a2) + (b - b2);
	sum[1] = estimate;

	return(sum);
}

/** Error-free product of two floating point numbers.
  * Store approximate result in global variable tempProduct.
  * See Shewchuk page 20.
  *
  * @return Rounding error. */

function twoProduct(a: number, b: number) {
	tempProduct = a * b;

	const a2 = a * dekkerSplitter;
	const aHi = a2 - (a2 - a);
	const aLo = a - aHi;

	const b2 = b * dekkerSplitter;
	const bHi = b2 - (b2 - b);
	const bLo = b - bHi;

	return(aLo * bLo - (tempProduct - aHi * bHi - aLo * bHi - aHi * bLo));
}

/** Arbitrary precision floating point number. Based on a multiple-component
  * expansion format and error free transformations.
  *
  * Maximum exponent is the same as for plain JavaScript numbers,
  * least significant representable binary digit is 2^-1074. */

export class BigFloat53 {

	/** @param value Initial value, a plain JavaScript floating point number
	  * (IEEE 754 double precision). */

	constructor(value?: number) {
		if(value) this.setValue(value);
	}

	/** Set value to zero.
	  *
	  * @return This object, for chaining. */

	setZero() {
		this.limbList.length = 0;
		return(this);
	}

	/** Set value to a plain JavaScript floating point number
	  * (IEEE 754 double precision).
	  *
	  * @param value New value.
	  * @return This object, for chaining. */

	setValue(value: number) {
		this.limbList.length = 1;
		this.limbList[0] = value;
		return(this);
	}

	/** Set value to the sum of two JavaScript numbers.
	  *
	  * @param a Augend.
	  * @param b Addend.
	  * @return This object, for chaining. */

	setSum(a: number, b: number) {
		this.limbList.length = 2;
		twoSum(a, b, this.limbList);
		return(this);
	}

	/** Set value to the product of two JavaScript numbers.
	  * @param a Multiplicand.
	  * @param b Multiplier.
	  * @return This object, for chaining. */

	setProduct(a: number, b: number) {
		this.limbList.length = 2;
		this.limbList[0] = twoProduct(a, b);
		this.limbList[1] = tempProduct;
		return(this);
	}

	/** See Compress from Shewchuk page 25. */

	// TODO: Test.
	normalize() {
		const limbList = this.limbList;
		let len = limbList.length;
		let limb: number;

		if(len) {
			let a = len - 1;
			let b = len - 1;

			let q = limbList[a];
			let err: number;

			while(a) {
				limb = limbList[--a];
				err = q;
				q += limb;

				err = limb - (q - err);

				limbList[b] = q;
				q = err || q;
				b -= err && 1;
			}

			limbList[b] = q;

			while(++b < len) {
				limb = limbList[b];
				err = q;
				q += limb;

				err -= q - limb;

				limbList[a] = q;
				q = err || q;
				a += err && 1;
			}

			limbList[a] = q;
			limbList.length = a + 1;
		}

		return(this);
	}

	/** Multiply this arbitrary precision float by a number.
	  * See Scale-Expansion from Shewchuk page 21.
	  *
	  * @param b Multiplier, a JavaScript floating point number.
	  * @param product Arbitrary precision float to overwrite with result.
	  * @return Modified product object. */

	mulSmall(b: number, product: BigFloat53) {
		const limbList = this.limbList;
		const productLimbs = product.limbList;
		const count = limbList.length;
		let t1: number, t2: number, t3: number;
		let srcPos = 0, dstPos = 0;

		/** Write output limb and move to next, unless a zero was written. */

		function writeLimb(limb: number) {
			productLimbs[dstPos] = limb;
			dstPos += limb && 1;
		}

		productLimbs.length = 1;

		writeLimb(twoProduct(limbList[srcPos++], b));
		let q = tempProduct;

		while(srcPos < count) {
			t1 = twoProduct(limbList[srcPos++], b);
			t2 = q + t1;
			t3 = t2 - q;
		
			writeLimb(q - (t2 - t3) + (t1 - t3));
			q = tempProduct + t2;
			writeLimb(t2 - (q - tempProduct));
		}

		productLimbs[dstPos] = q;

		return(product);
	}

	/** Multiply this by an arbitrary precision multiplier.
	  * Pass all components of the multiplier to mulSmall and sum the products.
	  *
	  * @param multiplier Number or arbitrary precision float.
	  * @param product Arbitrary precision float to overwrite with result.
	  * @return Modified product object. */

	private mulBig(multiplier: BigFloat53, product: BigFloat53) {
		const limbList = multiplier.limbList;
		let pos = limbList.length;

		if(!pos) return(product.setZero());

		--pos;
		this.mulSmall(limbList[pos], pos ? temp53[pos & 1] : product);

		while(pos) {
			--pos;
			this.mulSmall(limbList[pos], product).add(temp53[~pos & 1], pos ? temp53[pos & 1] : product);
		}

		return(product);
	}

	/** Multiply number or arbitrary precision float with this one
	  * and store result in another BigFloat53.
	  *
	  * @param multiplier Number or arbitrary precision float.
	  * @param product Arbitrary precision float to overwrite with result.
	  * If omitted, a new one is allocated.
	  * @return Modified product object. */

	mul(multiplier: number | BigFloat53, product?: BigFloat53) {
		product = product || new BigFloat53();

		if(typeof(multiplier) == 'number') {
			return(this.mulSmall(multiplier, product));
		}

		if(product == this) throw(new Error('Cannot multiply in place'));

		return(this.mulBig(multiplier, product));
	}

	// TODO
	// absDeltaFrom(other: number | BigFloat53) { return(0); }

	cmp: (other: number | BigFloat53) => number;

	isZero() {
		const limbList = this.limbList;

		for(let pos = limbList.length; pos--;) {
			if(limbList[pos]) return(false);
		}

		return(true);
	}

	/** Return an arbitrary number with sign matching the result of this - other. */

	// TODO: Test.
	deltaFrom(other: number | BigFloat53) {
		let t = this.limbList.length;
		let sign = t && (t = this.limbList[t - 1]) && (t > 0 ? 1 : -1);

		if(typeof(other) != 'number') {
			t = other.limbList.length;
			sign -= t && (t = other.limbList[t - 1]) && (t > 0 ? 1 : -1);
		} else sign -= other && (other > 0 ? 1 : -1);

		if(sign) return(sign);

		this.addSub(other, -1, temp53[0]);

		t = temp53[0].limbList.length;
		return(t && temp53[0].limbList[t - 1]);
	}

	/** Add a number to this arbitrary precision float.
	  * See Grow-Expansion from Shewchuk page 10.
	  *
	  * @param b JavaScript floating point number to add.
	  * @param sum Arbitrary precision float to overwrite with result.
	  * @return Modified sum object. */

	addSmall(b: number, sum: BigFloat53) {
		const limbList = this.limbList;
		const sumLimbs = sum.limbList;
		const count = limbList.length;
		let estimate: number;
		let a: number, a2: number, b2: number, err: number;
		let srcPos = 0, dstPos = 0;

		sumLimbs.length = 1;

		while(srcPos < count) {
			a = limbList[srcPos++];

			estimate = a + b;
			b2 = estimate - a;
			a -= estimate - b2;
			err = a + (b - b2);

			sumLimbs[dstPos] = err;
			dstPos += err && 1;
			b = estimate;
		}

		sumLimbs[dstPos] = b;

		return(sum);
	}

	/** Add another arbitrary precision float (multiplied by sign) to this one.
	  * See Fast-Expansion-Sum from Shewchuk page 13.
	  *
	  * @param sign Multiplier for negating addend to implement subtraction.
	  * @param sum Arbitrary precision float to overwrite with result.
	  * @return Modified sum object. */

	private addBig(addend: BigFloat53, sign: -1 | 1, sum: BigFloat53) {
		const augendLimbs = this.limbList;
		const addendLimbs = addend.limbList;
		const sumLimbs = sum.limbList;
		let count = augendLimbs.length + addendLimbs.length;
		let nextAugendPos = 0;
		let nextAddendPos = 0;
		let nextSumPos = 0;
		/** Latest limb of augend. */
		let a = augendLimbs[nextAugendPos++];
		/** Latest limb of addend. */
		let b = addendLimbs[nextAddendPos++] * sign;
		/** Magnitude of latest augend limb. */
		let a2 = a < 0 ? -a : a;
		/** Magnitude of latest addend limb. */
		let b2 = b < 0 ? -b : b;
		let nextLimb: number, nextLimb2: number, prevLimb: number;
		let err: number;

		if(!count) return(sum.setZero());
		sum.limbList.length = 1;

		// Append sentinel limbs to avoid testing for end of array.
		augendLimbs.push(Infinity);
		addendLimbs.push(Infinity);

		/** Get next smallest limb from either augend or addend.
		  * This avoids merging the two limb lists. */

		function getNextLimb() {
			let result: number;

			if(a2 < b2) {
				result = a;
				a = augendLimbs[nextAugendPos++];
				a2 = a < 0 ? -a : a;
			} else {
				result = b;
				b = addendLimbs[nextAddendPos++] * sign;
				b2 = b < 0 ? -b : b;
			}

			return(result);
		}

		let limb = getNextLimb();

		while(--count) {
			prevLimb = limb;
			nextLimb = getNextLimb();

			limb += nextLimb;
			nextLimb2 = limb - prevLimb;
			err = (prevLimb - (limb - nextLimb2)) + (nextLimb - nextLimb2);
		
			sumLimbs[nextSumPos] = err;
			nextSumPos += err && 1;
		}

		sumLimbs[nextSumPos] = limb;

		// Remove sentinel limbs.
		augendLimbs.pop();
		addendLimbs.pop();

		return(sum);
	}

	private addSub(addend: number | BigFloat53, sign: -1 | 1, result?: BigFloat53) {
		result = result || new BigFloat53();

		if(typeof(addend) == 'number') return(this.addSmall(sign * addend, result));

		return(this.addBig(addend, sign, result));
	}

	/** Add number or arbitrary precision float to this one
	  * and store result in another BigFloat53.
	  *
	  * @param addend Number or arbitrary precision float.
	  * @param sum Arbitrary precision float to overwrite with result.
	  * If omitted, a new one is allocated.
	  * @return Modified sum object. */

	add(addend: number | BigFloat53, sum?: BigFloat53) {
		return(this.addSub(addend, 1, sum));
	}

	/** Subtract number or arbitrary precision float from this one
	  * and store result in another BigFloat53.
	  *
	  * @param subtrahend Number or arbitrary precision float.
	  * @param difference Arbitrary precision float to overwrite with result.
	  * If omitted, a new one is allocated.
	  * @return Modified difference object. */

	sub(subtrahend: number | BigFloat53, difference?: BigFloat53) {
		return(this.addSub(subtrahend, -1, difference));
	}

	/** Round towards zero, to (at least) given number of base 2^53 fractional digits. */

	truncate(fractionLimbCount: number) {
		this.normalize();

		const limbList = this.limbList;
		let len = limbList.length;

		// Use binary search to find last |limb| < 1.

		let lo = 0;
		let hi = len;
		let mid = 0;
		let limb = 0;

		while(lo < hi) {
			mid = (lo + hi) >> 1;
			limb = limbList[mid];

			if(limb > -1 && limb < 1) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}

		if(mid && (limb <= -1 || limb >= 1)) {
			limb = limbList[--mid];
		}

		// Slice off limbs before and including it,
		// except the fractionLimbCount last ones.

		mid -= fractionLimbCount - 1;

		if(mid > 0) {
			len -= mid;
			let pos = 0;

			while(pos < len) {
				limbList[pos] = limbList[pos + mid];
				++pos;
			}

			limbList.length = len;
		}

		return(this);
	}

	round(decimalCount: number) {
		return(this.truncate(1 + ~~(decimalCount * limbsPerDigit53)));
	}

	// TODO: Test.
	valueOf() {
		this.normalize();

		return(this.limbList[this.limbList.length - 1]);
	}

	/** Convert to string in any base supported by Number.toString.
	  * @return String in lower case. */

	toString(base?: number) {
		const limbList = this.limbList;
		let pos = limbList.length;

		temp32[pos & 1].setZero();
		while(pos--) temp32[~pos & 1].add(limbList[pos], temp32[pos & 1]);

		return(temp32[~pos & 1].toString(base));
	}

	/** List of components ordered by increasing exponent. */
	private limbList: number[] = [];
}

BigFloat53.prototype.cmp = BigFloat53.prototype.deltaFrom;

/** Latest approximate product from twoProduct. */
let tempProduct = 0;

/** Temporary values for internal calculations. */
const temp32 = [ new BigFloat32(), new BigFloat32() ];

/** Temporary values for internal calculations. */
const temp53 = [ new BigFloat53(), new BigFloat53() ];
