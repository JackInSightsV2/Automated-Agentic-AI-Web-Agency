---
name: nanobanana-imaging
description: Expert image generation, editing, and restoration using the Nano Banana toolset. Use when the user needs high-quality visual assets, icons, patterns, diagrams, or sequential storyboards with consistent styling and precise control.
---

# Nano Banana Imaging

This skill provides specialized guidance for creating, editing, and restoring images using the Nano Banana MCP tools.

## Core Generation Principles

### 1. Precise Count Adherence
When a user specifies a `--count=N` parameter, you MUST generate exactly N images.
- `--count=3` means exactly 3 images.
- Default to 1 if no count is specified.

### 2. Style and Variation Compliance
- **`--styles`**: Apply exact artistic styles (e.g., watercolor, oil-painting, photorealistic).
- **`--variations`**: Implement specific variation types (e.g., lighting, angle, mood).
- When multiple styles are requested, ensure each image distinctly represents its assigned style.

### 3. Visual Consistency for Stories
When generating sequences (stories/processes), maintain strict consistency:
- **Color Palette**: Use identical or very similar color schemes.
- **Character/Object Design**: Keep features, clothing, and proportions consistent.
- **Art Style**: Maintain the same level of detail and aesthetic mood.

### 4. Text Accuracy
- Ensure all text within images is spelled correctly and grammatically proper.
- Only include relevant text; avoid hallucinations.

## Command-Specific Workflows

### Icon Generation (`mcp_nanobanana_generate_icon`)
- Focus on legibility at small sizes.
- Use platform-appropriate conventions (rounded vs. sharp).

### Pattern Generation (`mcp_nanobanana_generate_pattern`)
- For `seamless` patterns, ensure perfect tiling.
- Match requested `density` (sparse/medium/dense) accurately.

### Diagram Creation (`mcp_nanobanana_generate_diagram`)
- Use professional conventions and clear labels.
- Maintain readability for technical content.

### Image Editing & Restoration (`mcp_nanobanana_edit_image`, `mcp_nanobanana_restore_image`)
- Preserve the original image's quality and style.
- Make ONLY the requested modifications.
- For restoration, focus on repairing defects without altering intent.

## Prompt Engineering for Best Results
- **Be Descriptive**: Include details about lighting, composition, and mood.
- **Specify Perspective**: Use terms like "aerial view," "macro shot," or "low angle."
- **Define Materiality**: Mention textures like "brushed metal," "soft velvet," or "weathered wood."
