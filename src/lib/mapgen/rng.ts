/**
 * .NET Framework / Mono `System.Random` 的精确移植（减法滞后斐波那契生成器）。
 *
 * SCP:SL 地图生成使用 `new System.Random(seed)` 驱动所有布局随机，
 * 只有逐位复刻这个 RNG，seed 才能推导出完全一致的布局。
 *
 * 实现对照 .NET 参考源码：
 * - 56 个 int 的环形缓冲 SeedArray
 * - 每次采样取 SeedArray[inext] - SeedArray[inextp]，负则补 MBIG
 * - Next(maxValue) = (int)(Sample() * maxValue)（浮点截断，不是取模）
 *
 * 所有中间值均在 int32 范围内，JS number（53 位）直接安全；
 * 用 Math.floor 模拟 C# 的 (int) 截断（对正数等价）。
 */
const MBIG = 2147483647
const MSEED = 161803398

export class Rng {
  private seedArray = new Int32Array(56)
  private inext = 0
  private inextp = 21

  constructor(seed: number) {
    // 与 .NET 源码一致：取绝对值（int.MinValue 特例：Math.Abs(int.MinValue) 溢出回绕）
    const absSeed = seed === -2147483648 ? -2147483648 : Math.abs(seed)
    let mj = MSEED - absSeed
    this.seedArray[55] = mj
    let mk = 1
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55
      this.seedArray[ii] = mk
      mk = mj - mk
      if (mk < 0) mk += MBIG
      mj = this.seedArray[ii]
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        this.seedArray[i] -= this.seedArray[1 + (i + 30) % 55]
        if (this.seedArray[i] < 0) this.seedArray[i] += MBIG
      }
    }
    this.inext = 0
    this.inextp = 21
  }

  /** 核心采样：返回 [0, 1) 的 double（等价 .NET Sample()）。 */
  private sample(): number {
    let inext = this.inext + 1
    if (inext >= 56) inext = 1
    let inextp = this.inextp + 1
    if (inextp >= 56) inextp = 1
    // C# 的 int 减法会溢出回绕（unchecked），JS 必须用 |0 模拟 int32 截断
    let ret = (this.seedArray[inext] - this.seedArray[inextp]) | 0
    if (ret === MBIG) ret--
    if (ret < 0) ret += MBIG
    this.seedArray[inext] = ret
    this.inext = inext
    this.inextp = inextp
    return ret * (1 / MBIG)
  }

  /** 等价 .NET Random.Next()：全范围 int。 */
  next(): number {
    return Math.floor(this.sample() * MBIG)
  }

  /** 等价 .NET Random.Next(maxValue)：[0, maxValue)。maxValue 必须 > 0。 */
  nextInt(maxValue: number): number {
    return Math.floor(this.sample() * maxValue)
  }

  /** 等价 .NET Random.Next(minValue, maxValue)。 */
  nextIntRange(minValue: number, maxValue: number): number {
    const range = maxValue - minValue
    return Math.floor(this.sample() * range) + minValue
  }

  /** 等价 .NET Random.NextDouble()。 */
  nextDouble(): number {
    return this.sample()
  }
}
