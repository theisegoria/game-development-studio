/*
 * A windowless Vulkan engine that produces a sealed, GPU-attested capture.
 *
 * Vulkan is the best-instrumented lane, and this example uses what it
 * offers: timestamp queries for per-pass GPU time, pipeline statistics for a
 * hardware-measured fragment invocation count (the honest overdraw figure),
 * a memory budget report for VRAM, and the validation layer's messages
 * counted into diagnostic telemetry. Each number says how it was measured.
 *
 * What it is honest about, because the harness will check:
 *
 *   - A CPU device (lavapipe, SwiftShader) is declared GDPROBE_RENDERER_SOFTWARE
 *     and makes no GPU attestation; the SDK would refuse one anyway, and the
 *     harness downgrades the run regardless of what either says.
 *   - The attestation is TIMESTAMP_RESOLVED when the pass's timestamp pair
 *     came back available, else FENCE_SIGNALLED after vkWaitForFences. Never
 *     "we submitted it".
 *   - Pipeline statistics are emitted only when the device has the feature.
 *     MoltenVK does not; nothing is claimed there.
 *
 * Build with ./build.sh (glslc for the shaders, cc for the rest). The two
 * .spv files are loaded from the executable's own directory at runtime.
 * Outside the harness it renders once and exits 0.
 */

#define _POSIX_C_SOURCE 200809L

#include "../../c/gdprobe.h"

#include <vulkan/vulkan.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define WIDTH 64
#define HEIGHT 32
#define VERTEX_COUNT 12

#define CHECK(call) do { VkResult r_ = (call); if (r_ != VK_SUCCESS) { \
  fprintf(stderr, "%s failed: %d\n", #call, (int) r_); return 1; } } while (0)

typedef struct { float position[2]; uint32_t object; } vertex_in;

static double nanoseconds_now(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (double) now.tv_sec * 1e9 + (double) now.tv_nsec;
}

static uint32_t *read_spirv(const char *directory, const char *name, size_t *out_words) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s", directory, name);
  FILE *file = fopen(path, "rb");
  if (!file) { fprintf(stderr, "cannot open %s (run build.sh)\n", path); return NULL; }
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  fseek(file, 0, SEEK_SET);
  if (size <= 0 || size % 4 != 0) { fclose(file); fprintf(stderr, "%s is not SPIR-V\n", path); return NULL; }
  uint32_t *words = malloc((size_t) size);
  if (!words || fread(words, 1, (size_t) size, file) != (size_t) size) { fclose(file); free(words); return NULL; }
  fclose(file);
  *out_words = (size_t) size / 4;
  return words;
}

static int has_extension(const VkExtensionProperties *list, uint32_t count, const char *name) {
  for (uint32_t i = 0; i < count; i += 1) if (strcmp(list[i].extensionName, name) == 0) return 1;
  return 0;
}

static uint32_t find_memory(const VkPhysicalDeviceMemoryProperties *memory, uint32_t type_bits, VkMemoryPropertyFlags flags) {
  for (uint32_t i = 0; i < memory->memoryTypeCount; i += 1) {
    if ((type_bits & (1u << i)) && (memory->memoryTypes[i].propertyFlags & flags) == flags) return i;
  }
  return UINT32_MAX;
}

static uint32_t validation_messages = 0;

static VKAPI_ATTR VkBool32 VKAPI_CALL on_debug_message(
    VkDebugUtilsMessageSeverityFlagBitsEXT severity, VkDebugUtilsMessageTypeFlagsEXT types,
    const VkDebugUtilsMessengerCallbackDataEXT *data, void *user) {
  (void) types; (void) user;
  if (severity >= VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT) {
    validation_messages += 1;
    /* stderr is captured into the sealed run, so the text is not lost. */
    fprintf(stderr, "validation: %s\n", data->pMessage);
  }
  return VK_FALSE;
}

int main(int argc, char **argv) {
  float brightness = argc > 1 ? (float) atoi(argv[1]) : 0.0f;
  char directory[1024] = ".";
  if (argc > 0 && strrchr(argv[0], '/')) {
    size_t length = (size_t) (strrchr(argv[0], '/') - argv[0]);
    if (length < sizeof directory) { memcpy(directory, argv[0], length); directory[length] = '\0'; }
  }

  gdprobe_status status;
  gdprobe_run *run = gdprobe_run_begin(&status);
  if (!run && status != GDPROBE_NOT_ATTACHED) {
    fprintf(stderr, "probe failed to start: %d\n", (int) status);
    return 1;
  }

  /* ---------------------------------------------------------------- instance */
  uint32_t instance_extension_count = 0;
  vkEnumerateInstanceExtensionProperties(NULL, &instance_extension_count, NULL);
  VkExtensionProperties *instance_extensions = calloc(instance_extension_count, sizeof *instance_extensions);
  vkEnumerateInstanceExtensionProperties(NULL, &instance_extension_count, instance_extensions);
  int portability = has_extension(instance_extensions, instance_extension_count, "VK_KHR_portability_enumeration");
  int debug_utils = has_extension(instance_extensions, instance_extension_count, VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
  int properties2 = has_extension(instance_extensions, instance_extension_count, VK_KHR_GET_PHYSICAL_DEVICE_PROPERTIES_2_EXTENSION_NAME);

  uint32_t layer_count = 0;
  vkEnumerateInstanceLayerProperties(&layer_count, NULL);
  VkLayerProperties *layers = calloc(layer_count, sizeof *layers);
  vkEnumerateInstanceLayerProperties(&layer_count, layers);
  int validation = 0;
  for (uint32_t i = 0; i < layer_count; i += 1) {
    if (strcmp(layers[i].layerName, "VK_LAYER_KHRONOS_validation") == 0) validation = debug_utils;
  }

  const char *enabled_instance_extensions[4];
  uint32_t enabled_instance_extension_count = 0;
  if (portability) enabled_instance_extensions[enabled_instance_extension_count++] = "VK_KHR_portability_enumeration";
  if (properties2) enabled_instance_extensions[enabled_instance_extension_count++] = VK_KHR_GET_PHYSICAL_DEVICE_PROPERTIES_2_EXTENSION_NAME;
  if (validation) enabled_instance_extensions[enabled_instance_extension_count++] = VK_EXT_DEBUG_UTILS_EXTENSION_NAME;
  const char *enabled_layers[1] = { "VK_LAYER_KHRONOS_validation" };

  VkApplicationInfo application = { VK_STRUCTURE_TYPE_APPLICATION_INFO, NULL, "gdprobe-vulkan", 1, "gdprobe", 1, VK_API_VERSION_1_1 };
  VkInstanceCreateInfo instance_info = { VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, NULL,
    portability ? VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR : 0, &application,
    validation ? 1u : 0u, enabled_layers, enabled_instance_extension_count, enabled_instance_extensions };
  VkInstance instance;
  CHECK(vkCreateInstance(&instance_info, NULL, &instance));
  free(instance_extensions);
  free(layers);

  VkDebugUtilsMessengerEXT messenger = VK_NULL_HANDLE;
  if (validation) {
    PFN_vkCreateDebugUtilsMessengerEXT create = (PFN_vkCreateDebugUtilsMessengerEXT)
      vkGetInstanceProcAddr(instance, "vkCreateDebugUtilsMessengerEXT");
    VkDebugUtilsMessengerCreateInfoEXT messenger_info = { VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT, NULL, 0,
      VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT,
      VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT,
      on_debug_message, NULL };
    if (create) create(instance, &messenger_info, NULL, &messenger);
  }

  /* ---------------------------------------------------------- physical device */
  uint32_t device_count = 0;
  vkEnumeratePhysicalDevices(instance, &device_count, NULL);
  if (device_count == 0) { fprintf(stderr, "no Vulkan device\n"); return 1; }
  VkPhysicalDevice *devices = calloc(device_count, sizeof *devices);
  vkEnumeratePhysicalDevices(instance, &device_count, devices);
  /* Prefer a real GPU; fall back to whatever is there, including a CPU. */
  VkPhysicalDevice physical = devices[0];
  VkPhysicalDeviceProperties properties;
  for (uint32_t i = 0; i < device_count; i += 1) {
    vkGetPhysicalDeviceProperties(devices[i], &properties);
    if (properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
        || properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) { physical = devices[i]; break; }
  }
  free(devices);
  vkGetPhysicalDeviceProperties(physical, &properties);
  VkPhysicalDeviceFeatures features;
  vkGetPhysicalDeviceFeatures(physical, &features);
  VkPhysicalDeviceMemoryProperties memory;
  vkGetPhysicalDeviceMemoryProperties(physical, &memory);

  int software = properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU;
  int pipeline_statistics = features.pipelineStatisticsQuery == VK_TRUE;

  uint32_t family_count = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(physical, &family_count, NULL);
  VkQueueFamilyProperties *families = calloc(family_count, sizeof *families);
  vkGetPhysicalDeviceQueueFamilyProperties(physical, &family_count, families);
  uint32_t graphics_family = UINT32_MAX;
  uint32_t timestamp_bits = 0;
  for (uint32_t i = 0; i < family_count; i += 1) {
    if (families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) { graphics_family = i; timestamp_bits = families[i].timestampValidBits; break; }
  }
  free(families);
  if (graphics_family == UINT32_MAX) { fprintf(stderr, "no graphics queue\n"); return 1; }
  int timestamps = timestamp_bits > 0 && properties.limits.timestampComputeAndGraphics == VK_TRUE;

  if (run) {
    char driver[64];
    snprintf(driver, sizeof driver, "%u.%u.%u", VK_VERSION_MAJOR(properties.driverVersion),
             VK_VERSION_MINOR(properties.driverVersion), VK_VERSION_PATCH(properties.driverVersion));
    gdprobe_declare_backend(run, GDPROBE_BACKEND_VULKAN, properties.deviceName, driver,
                            software ? GDPROBE_RENDERER_SOFTWARE : GDPROBE_RENDERER_HARDWARE);
  }

  /* ------------------------------------------------------------------ device */
  uint32_t device_extension_count = 0;
  vkEnumerateDeviceExtensionProperties(physical, NULL, &device_extension_count, NULL);
  VkExtensionProperties *device_extensions = calloc(device_extension_count, sizeof *device_extensions);
  vkEnumerateDeviceExtensionProperties(physical, NULL, &device_extension_count, device_extensions);
  const char *enabled_device_extensions[2];
  uint32_t enabled_device_extension_count = 0;
  if (has_extension(device_extensions, device_extension_count, "VK_KHR_portability_subset")) {
    enabled_device_extensions[enabled_device_extension_count++] = "VK_KHR_portability_subset";
  }
  int memory_budget = properties2 && has_extension(device_extensions, device_extension_count, VK_EXT_MEMORY_BUDGET_EXTENSION_NAME);
  if (memory_budget) enabled_device_extensions[enabled_device_extension_count++] = VK_EXT_MEMORY_BUDGET_EXTENSION_NAME;
  free(device_extensions);

  float priority = 1.0f;
  VkDeviceQueueCreateInfo queue_info = { VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, NULL, 0, graphics_family, 1, &priority };
  VkPhysicalDeviceFeatures enabled_features;
  memset(&enabled_features, 0, sizeof enabled_features);
  enabled_features.pipelineStatisticsQuery = pipeline_statistics ? VK_TRUE : VK_FALSE;
  VkDeviceCreateInfo device_info = { VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, NULL, 0, 1, &queue_info, 0, NULL,
    enabled_device_extension_count, enabled_device_extensions, &enabled_features };
  VkDevice device;
  CHECK(vkCreateDevice(physical, &device_info, NULL, &device));
  VkQueue queue;
  vkGetDeviceQueue(device, graphics_family, 0, &queue);

  /* ------------------------------------------------------- render targets */
  VkImage images[2];
  VkDeviceMemory image_memory[2];
  VkImageView views[2];
  VkFormat formats[2] = { VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_R32_UINT };
  for (int i = 0; i < 2; i += 1) {
    VkImageCreateInfo image_info = { VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO, NULL, 0, VK_IMAGE_TYPE_2D, formats[i],
      { WIDTH, HEIGHT, 1 }, 1, 1, VK_SAMPLE_COUNT_1_BIT, VK_IMAGE_TILING_OPTIMAL,
      VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
      VK_SHARING_MODE_EXCLUSIVE, 0, NULL, VK_IMAGE_LAYOUT_UNDEFINED };
    CHECK(vkCreateImage(device, &image_info, NULL, &images[i]));
    VkMemoryRequirements requirements;
    vkGetImageMemoryRequirements(device, images[i], &requirements);
    VkMemoryAllocateInfo allocate = { VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, NULL, requirements.size,
      find_memory(&memory, requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT) };
    CHECK(vkAllocateMemory(device, &allocate, NULL, &image_memory[i]));
    CHECK(vkBindImageMemory(device, images[i], image_memory[i], 0));
    VkImageViewCreateInfo view_info = { VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO, NULL, 0, images[i], VK_IMAGE_VIEW_TYPE_2D, formats[i],
      { VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY },
      { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 } };
    CHECK(vkCreateImageView(device, &view_info, NULL, &views[i]));
  }

  VkAttachmentDescription attachments[2];
  VkAttachmentReference references[2];
  for (int i = 0; i < 2; i += 1) {
    VkAttachmentDescription description = { 0, formats[i], VK_SAMPLE_COUNT_1_BIT, VK_ATTACHMENT_LOAD_OP_CLEAR, VK_ATTACHMENT_STORE_OP_STORE,
      VK_ATTACHMENT_LOAD_OP_DONT_CARE, VK_ATTACHMENT_STORE_OP_DONT_CARE, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL };
    attachments[i] = description;
    references[i].attachment = (uint32_t) i;
    references[i].layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
  }
  VkSubpassDescription subpass = { 0, VK_PIPELINE_BIND_POINT_GRAPHICS, 0, NULL, 2, references, NULL, NULL, 0, NULL };
  VkRenderPassCreateInfo pass_info = { VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO, NULL, 0, 2, attachments, 1, &subpass, 0, NULL };
  VkRenderPass render_pass;
  CHECK(vkCreateRenderPass(device, &pass_info, NULL, &render_pass));
  VkFramebufferCreateInfo framebuffer_info = { VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO, NULL, 0, render_pass, 2, views, WIDTH, HEIGHT, 1 };
  VkFramebuffer framebuffer;
  CHECK(vkCreateFramebuffer(device, &framebuffer_info, NULL, &framebuffer));

  /* ---------------------------------------------------------------- pipeline */
  size_t vertex_words, fragment_words;
  uint32_t *vertex_code = read_spirv(directory, "shader.vert.spv", &vertex_words);
  uint32_t *fragment_code = read_spirv(directory, "shader.frag.spv", &fragment_words);
  if (!vertex_code || !fragment_code) return 1;
  VkShaderModuleCreateInfo vertex_module_info = { VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, NULL, 0, vertex_words * 4, vertex_code };
  VkShaderModuleCreateInfo fragment_module_info = { VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, NULL, 0, fragment_words * 4, fragment_code };
  VkShaderModule vertex_module, fragment_module;
  CHECK(vkCreateShaderModule(device, &vertex_module_info, NULL, &vertex_module));
  CHECK(vkCreateShaderModule(device, &fragment_module_info, NULL, &fragment_module));
  free(vertex_code);
  free(fragment_code);

  VkPipelineShaderStageCreateInfo stages[2] = {
    { VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, NULL, 0, VK_SHADER_STAGE_VERTEX_BIT, vertex_module, "main", NULL },
    { VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, NULL, 0, VK_SHADER_STAGE_FRAGMENT_BIT, fragment_module, "main", NULL },
  };
  /* The stride is the C struct's, stated explicitly: 12 bytes. */
  VkVertexInputBindingDescription binding = { 0, sizeof(vertex_in), VK_VERTEX_INPUT_RATE_VERTEX };
  VkVertexInputAttributeDescription vertex_attributes[2] = {
    { 0, 0, VK_FORMAT_R32G32_SFLOAT, 0 }, { 1, 0, VK_FORMAT_R32_UINT, 8 },
  };
  VkPipelineVertexInputStateCreateInfo vertex_input = { VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO, NULL, 0, 1, &binding, 2, vertex_attributes };
  VkPipelineInputAssemblyStateCreateInfo assembly = { VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO, NULL, 0, VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST, VK_FALSE };
  VkViewport viewport = { 0, 0, WIDTH, HEIGHT, 0, 1 };
  VkRect2D scissor = { { 0, 0 }, { WIDTH, HEIGHT } };
  VkPipelineViewportStateCreateInfo viewport_state = { VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO, NULL, 0, 1, &viewport, 1, &scissor };
  VkPipelineRasterizationStateCreateInfo raster = { VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO, NULL, 0, VK_FALSE, VK_FALSE,
    VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE, VK_FRONT_FACE_COUNTER_CLOCKWISE, VK_FALSE, 0, 0, 0, 1.0f };
  VkPipelineMultisampleStateCreateInfo multisample = { VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO, NULL, 0, VK_SAMPLE_COUNT_1_BIT, VK_FALSE, 0, NULL, VK_FALSE, VK_FALSE };
  VkPipelineColorBlendAttachmentState blend_attachments[2];
  memset(blend_attachments, 0, sizeof blend_attachments);
  blend_attachments[0].colorWriteMask = blend_attachments[1].colorWriteMask = 0xF;
  VkPipelineColorBlendStateCreateInfo blend = { VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO, NULL, 0, VK_FALSE, VK_LOGIC_OP_COPY, 2, blend_attachments, { 0, 0, 0, 0 } };
  VkPushConstantRange push_range = { VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(float) };
  VkPipelineLayoutCreateInfo layout_info = { VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO, NULL, 0, 0, NULL, 1, &push_range };
  VkPipelineLayout layout;
  CHECK(vkCreatePipelineLayout(device, &layout_info, NULL, &layout));
  VkGraphicsPipelineCreateInfo pipeline_info = { VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO, NULL, 0, 2, stages, &vertex_input, &assembly, NULL,
    &viewport_state, &raster, &multisample, NULL, &blend, NULL, layout, render_pass, 0, VK_NULL_HANDLE, -1 };
  VkPipeline pipeline;
  double compile_start = nanoseconds_now();
  CHECK(vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &pipeline_info, NULL, &pipeline));
  double compile_ns = nanoseconds_now() - compile_start;

  /* ----------------------------------------------------------------- buffers */
  vertex_in vertices[VERTEX_COUNT] = {
    {{-1, -1}, 1}, {{0, -1}, 1}, {{-1, 1}, 1}, {{0, -1}, 1}, {{0, 1}, 1}, {{-1, 1}, 1},
    {{0, -1}, 2}, {{1, -1}, 2}, {{0, 1}, 2}, {{1, -1}, 2}, {{1, 1}, 2}, {{0, 1}, 2},
  };
  VkBuffer buffers[3];
  VkDeviceMemory buffer_memory[3];
  VkDeviceSize sizes[3] = { sizeof vertices, WIDTH * HEIGHT * 4, WIDTH * HEIGHT * 4 };
  VkBufferUsageFlags usages[3] = { VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, VK_BUFFER_USAGE_TRANSFER_DST_BIT, VK_BUFFER_USAGE_TRANSFER_DST_BIT };
  for (int i = 0; i < 3; i += 1) {
    VkBufferCreateInfo buffer_info = { VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO, NULL, 0, sizes[i], usages[i], VK_SHARING_MODE_EXCLUSIVE, 0, NULL };
    CHECK(vkCreateBuffer(device, &buffer_info, NULL, &buffers[i]));
    VkMemoryRequirements requirements;
    vkGetBufferMemoryRequirements(device, buffers[i], &requirements);
    VkMemoryAllocateInfo allocate = { VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, NULL, requirements.size,
      find_memory(&memory, requirements.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) };
    CHECK(vkAllocateMemory(device, &allocate, NULL, &buffer_memory[i]));
    CHECK(vkBindBufferMemory(device, buffers[i], buffer_memory[i], 0));
  }
  void *mapped;
  CHECK(vkMapMemory(device, buffer_memory[0], 0, sizeof vertices, 0, &mapped));
  memcpy(mapped, vertices, sizeof vertices);
  vkUnmapMemory(device, buffer_memory[0]);

  /* ----------------------------------------------------------------- queries */
  VkQueryPool timestamp_pool = VK_NULL_HANDLE, statistics_pool = VK_NULL_HANDLE;
  if (timestamps) {
    VkQueryPoolCreateInfo pool_info = { VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO, NULL, 0, VK_QUERY_TYPE_TIMESTAMP, 2, 0 };
    CHECK(vkCreateQueryPool(device, &pool_info, NULL, &timestamp_pool));
  }
  if (pipeline_statistics) {
    VkQueryPoolCreateInfo pool_info = { VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO, NULL, 0, VK_QUERY_TYPE_PIPELINE_STATISTICS, 1,
      VK_QUERY_PIPELINE_STATISTIC_FRAGMENT_SHADER_INVOCATIONS_BIT | VK_QUERY_PIPELINE_STATISTIC_CLIPPING_PRIMITIVES_BIT };
    CHECK(vkCreateQueryPool(device, &pool_info, NULL, &statistics_pool));
  }

  /* ---------------------------------------------------------------- commands */
  VkCommandPoolCreateInfo command_pool_info = { VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO, NULL, 0, graphics_family };
  VkCommandPool command_pool;
  CHECK(vkCreateCommandPool(device, &command_pool_info, NULL, &command_pool));
  VkCommandBufferAllocateInfo command_info = { VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, NULL, command_pool, VK_COMMAND_BUFFER_LEVEL_PRIMARY, 1 };
  VkCommandBuffer commands;
  CHECK(vkAllocateCommandBuffers(device, &command_info, &commands));
  VkCommandBufferBeginInfo begin = { VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO, NULL, VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT, NULL };
  CHECK(vkBeginCommandBuffer(commands, &begin));
  if (timestamp_pool) {
    vkCmdResetQueryPool(commands, timestamp_pool, 0, 2);
    vkCmdWriteTimestamp(commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, timestamp_pool, 0);
  }
  if (statistics_pool) vkCmdResetQueryPool(commands, statistics_pool, 0, 1);
  VkClearValue clears[2];
  memset(clears, 0, sizeof clears);
  clears[0].color.float32[3] = 1.0f;
  VkRenderPassBeginInfo pass_begin = { VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO, NULL, render_pass, framebuffer, { { 0, 0 }, { WIDTH, HEIGHT } }, 2, clears };
  vkCmdBeginRenderPass(commands, &pass_begin, VK_SUBPASS_CONTENTS_INLINE);
  if (statistics_pool) vkCmdBeginQuery(commands, statistics_pool, 0, 0);
  vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
  VkDeviceSize zero = 0;
  vkCmdBindVertexBuffers(commands, 0, 1, &buffers[0], &zero);
  vkCmdPushConstants(commands, layout, VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof brightness, &brightness);
  vkCmdDraw(commands, VERTEX_COUNT, 1, 0, 0);
  if (statistics_pool) vkCmdEndQuery(commands, statistics_pool, 0);
  vkCmdEndRenderPass(commands);
  if (timestamp_pool) vkCmdWriteTimestamp(commands, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, timestamp_pool, 1);
  for (int i = 0; i < 2; i += 1) {
    /* bufferRowLength 0: tightly packed, so the row stride handed to the SDK is WIDTH * 4. */
    VkBufferImageCopy copy = { 0, 0, 0, { VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 }, { 0, 0, 0 }, { WIDTH, HEIGHT, 1 } };
    vkCmdCopyImageToBuffer(commands, images[i], VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, buffers[1 + i], 1, &copy);
  }
  CHECK(vkEndCommandBuffer(commands));

  VkFenceCreateInfo fence_info = { VK_STRUCTURE_TYPE_FENCE_CREATE_INFO, NULL, 0 };
  VkFence fence;
  CHECK(vkCreateFence(device, &fence_info, NULL, &fence));
  VkSubmitInfo submit = { VK_STRUCTURE_TYPE_SUBMIT_INFO, NULL, 0, NULL, NULL, 1, &commands, 0, NULL };
  double cpu_start = nanoseconds_now();
  CHECK(vkQueueSubmit(queue, 1, &submit, fence));
  CHECK(vkWaitForFences(device, 1, &fence, VK_TRUE, UINT64_MAX));
  double cpu_end = nanoseconds_now();

  /* ------------------------------------------------------------------ results */
  double pass_ns = -1;
  if (timestamp_pool) {
    uint64_t stamps[4];
    VkResult got = vkGetQueryPoolResults(device, timestamp_pool, 0, 2, sizeof stamps, stamps, 16,
      VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT | VK_QUERY_RESULT_WITH_AVAILABILITY_BIT);
    if (got == VK_SUCCESS && stamps[1] != 0 && stamps[3] != 0 && stamps[2] >= stamps[0]) {
      pass_ns = (double) (stamps[2] - stamps[0]) * properties.limits.timestampPeriod;
    }
  }
  uint64_t fragment_invocations = 0, clipped_primitives = 0;
  int statistics_valid = 0;
  if (statistics_pool) {
    uint64_t results[2];
    if (vkGetQueryPoolResults(device, statistics_pool, 0, 1, sizeof results, results, sizeof results,
                              VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT) == VK_SUCCESS) {
      fragment_invocations = results[0];
      clipped_primitives = results[1];
      statistics_valid = 1;
    }
  }

  if (!run) {
    puts("not attached to the harness; rendered one frame");
    vkDeviceWaitIdle(device);
    return 0;
  }

  /* The attestation says HOW the engine knows. A software device makes none:
     the SDK would refuse it, and the harness downgrades the run regardless. */
  if (!software) {
    gdprobe_status attested = pass_ns >= 0
      ? gdprobe_attest_gpu(run, GDPROBE_GPU_TIMESTAMP_RESOLVED, "timestamp query pair available after vkWaitForFences")
      : gdprobe_attest_gpu(run, GDPROBE_GPU_FENCE_SIGNALLED, "vkWaitForFences returned; no timestamp support");
    if (attested != GDPROBE_OK) { fprintf(stderr, "attestation refused: %s\n", gdprobe_last_error(run)); gdprobe_run_discard(run); return 1; }
    gdprobe_attest_performance(run, 1, "timings below name what measured them");
  }

  void *color_pixels, *id_pixels;
  CHECK(vkMapMemory(device, buffer_memory[1], 0, WIDTH * HEIGHT * 4, 0, &color_pixels));
  CHECK(vkMapMemory(device, buffer_memory[2], 0, WIDTH * HEIGHT * 4, 0, &id_pixels));
  gdprobe_frame *frame = gdprobe_frame_begin(run, 0, "Main View");
  if (!frame
      || gdprobe_attach_rgba8(frame, GDPROBE_KIND_COLOR, NULL, color_pixels, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK
      || gdprobe_attach_ids(frame, GDPROBE_KIND_OBJECT_ID, NULL, id_pixels, WIDTH, HEIGHT, WIDTH * 4) != GDPROBE_OK) {
    fprintf(stderr, "attach failed: %s\n", gdprobe_last_error(run));
    gdprobe_run_discard(run);
    return 1;
  }
  gdprobe_frame_end(frame);
  vkUnmapMemory(device, buffer_memory[1]);
  vkUnmapMemory(device, buffer_memory[2]);

  /* Every number says what measured it. */
  if (pass_ns >= 0) {
    gdprobe_emit_measured(run, "render", "pass.main.gpu_duration_ns", pass_ns, "ns", 0, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
  }
  if (statistics_valid) {
    gdprobe_emit_measured(run, "render", "pipeline_statistics.fragment_invocations", (double) fragment_invocations, "count", 0,
                          GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY);
    gdprobe_emit_measured(run, "render", "pipeline_statistics.clipping_primitives", (double) clipped_primitives, "count", 0,
                          GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY);
    /* The honest overdraw figure: fragments the hardware actually ran per pixel. */
    gdprobe_emit_measured(run, "render", "overdraw.fragments_per_pixel", (double) fragment_invocations / (WIDTH * HEIGHT), "ratio", 0,
                          GDPROBE_MEASURED_PIPELINE_STATISTICS_QUERY);
  }
  if (memory_budget) {
    PFN_vkGetPhysicalDeviceMemoryProperties2KHR get_memory2 = (PFN_vkGetPhysicalDeviceMemoryProperties2KHR)
      vkGetInstanceProcAddr(instance, "vkGetPhysicalDeviceMemoryProperties2KHR");
    if (get_memory2) {
      VkPhysicalDeviceMemoryBudgetPropertiesEXT budget = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_BUDGET_PROPERTIES_EXT, NULL, { 0 }, { 0 } };
      VkPhysicalDeviceMemoryProperties2KHR memory2 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_PROPERTIES_2_KHR, &budget, { 0, { { 0, 0 } }, 0, { { 0, 0 } } } };
      get_memory2(physical, &memory2);
      double used = 0;
      for (uint32_t i = 0; i < memory2.memoryProperties.memoryHeapCount; i += 1) {
        if (memory2.memoryProperties.memoryHeaps[i].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) used += (double) budget.heapUsage[i];
      }
      gdprobe_emit_measured(run, "resource", "vram.used_bytes", used, "bytes", -1, GDPROBE_MEASURED_DRIVER_REPORT);
    }
  }
  gdprobe_emit_measured(run, "performance", "frame_time", (cpu_end - cpu_start) / 1e6, "ms", 0, GDPROBE_MEASURED_WALL_CLOCK);
  gdprobe_emit_measured(run, "performance", "pipeline_creation_ms", compile_ns / 1e6, "ms", -1, GDPROBE_MEASURED_WALL_CLOCK);
  gdprobe_emit_measured(run, "diagnostic", "vulkan.validation_messages", (double) validation_messages, "count", -1, GDPROBE_MEASURED_ENGINE_COUNTER);
  gdprobe_measure_measured(run, "render.draw_calls", 1.0, "count", "sample", 0, GDPROBE_MEASURED_ENGINE_COUNTER);

  status = gdprobe_run_end(run);
  if (status != GDPROBE_OK) {
    fprintf(stderr, "probe failed to finish: %s\n", gdprobe_last_error(run));
    gdprobe_run_discard(run);
    return 1;
  }

  vkDeviceWaitIdle(device);
  vkDestroyFence(device, fence, NULL);
  vkDestroyCommandPool(device, command_pool, NULL);
  if (timestamp_pool) vkDestroyQueryPool(device, timestamp_pool, NULL);
  if (statistics_pool) vkDestroyQueryPool(device, statistics_pool, NULL);
  for (int i = 0; i < 3; i += 1) { vkDestroyBuffer(device, buffers[i], NULL); vkFreeMemory(device, buffer_memory[i], NULL); }
  vkDestroyPipeline(device, pipeline, NULL);
  vkDestroyPipelineLayout(device, layout, NULL);
  vkDestroyShaderModule(device, vertex_module, NULL);
  vkDestroyShaderModule(device, fragment_module, NULL);
  vkDestroyFramebuffer(device, framebuffer, NULL);
  vkDestroyRenderPass(device, render_pass, NULL);
  for (int i = 0; i < 2; i += 1) { vkDestroyImageView(device, views[i], NULL); vkDestroyImage(device, images[i], NULL); vkFreeMemory(device, image_memory[i], NULL); }
  vkDestroyDevice(device, NULL);
  if (messenger) {
    PFN_vkDestroyDebugUtilsMessengerEXT destroy = (PFN_vkDestroyDebugUtilsMessengerEXT) vkGetInstanceProcAddr(instance, "vkDestroyDebugUtilsMessengerEXT");
    if (destroy) destroy(instance, messenger, NULL);
  }
  vkDestroyInstance(instance, NULL);
  return 0;
}
