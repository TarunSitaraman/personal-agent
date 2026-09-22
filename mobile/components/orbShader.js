// SkSL port of the GradientOrb fragment shader: a glowing orb whose rim is pushed around by 3D
// simplex noise, three colours mixed by angle and noise, a breathing pulse, and a highlight that
// orbits the rim. Differences from the WebGL original:
//   - SkSL entry point (half4 main(float2)), float2/3/4 types, colours passed as uniforms so the
//     palette follows Blu's theme instead of a hue rotation;
//   - output is premultiplied, so the orb composites over the sky with no background.
// Kept free of React Native imports so it can be compiled and rendered in Node (CanvasKit).
export const ORB_SKSL = `
uniform float iTime;
uniform float2 iResolution;
uniform float rot;
uniform float noiseScale;
uniform float innerRadius;
uniform float3 c0;
uniform float3 c1;
uniform float3 c2;

float3 hash33(float3 p3) {
  p3 = fract(p3 * float3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(float3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}

float snoise3(float3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  float3 i = floor(p + (p.x + p.y + p.z) * K1);
  float3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  float3 e = step(float3(0.0), d0 - d0.yzx);
  float3 i1 = e * (1.0 - e.zxy);
  float3 i2 = 1.0 - e.zxy * (1.0 - e);
  float3 d1 = d0 - (i1 - K2);
  float3 d2 = d0 - (i2 - K1);
  float3 d3 = d0 - 0.5;
  float4 h = max(0.6 - float4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  float4 n = h * h * h * h * float4(
    dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(float4(31.316), n);
}

float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

half4 main(float2 fragCoord) {
  float2 center = iResolution * 0.5;
  float size = min(iResolution.x, iResolution.y);
  float2 uv = (fragCoord - center) / size * 2.0;
  float s = sin(rot);
  float c = cos(rot);
  uv = float2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;
  float pulse = sin(iTime * 1.5) * 0.02;
  float n0 = snoise3(float3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius + pulse, 1.0, 0.4), mix(innerRadius + pulse, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0 * 1.05, r0, len);
  float cl = cos(atan(uv.y, uv.x) + iTime * 2.0) * 0.5 + 0.5;

  float a = -iTime;
  float2 pos = float2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);

  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

  float3 col = mix(c1, c2, cl);
  col = mix(col, c0, n0);
  col = mix(float3(0.0), col, v0);
  col = (col + v1) * v2 * v3;
  col = clamp(col, 0.0, 1.0);

  float al = max(max(col.r, col.g), col.b);
  return half4(half3(col), half(al)); // col is already colour * alpha: premultiplied
}
`;

// Blu's palette for the orb: deep sky blue, the accent, and a cold cyan — the original's blue /
// purple / orange moved into the app's one hue family.
export const ORB_COLORS = {
  c0: [0.24, 0.36, 1.0],
  c1: [0.51, 0.66, 1.0],
  c2: [0.3, 0.86, 1.0],
};
