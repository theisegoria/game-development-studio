#version 450
layout(location = 0) in vec2 position;
layout(location = 1) in uint object;
layout(location = 0) flat out uint vObject;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  vObject = object;
}
