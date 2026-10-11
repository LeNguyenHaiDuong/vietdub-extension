import math
from PIL import Image, ImageDraw

def create_vietdub_icon(size):
    # Create RGBA canvas
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Rounded background
    padding = size * 0.04
    radius = size * 0.24
    
    # Base dark gradient / navy rounded rect
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=radius,
        fill=(10, 25, 47, 255),
        outline=(0, 242, 254, 255),
        width=max(1, int(size * 0.05))
    )
    
    # Soundwaves / speech bubble in center
    cx, cy = size / 2, size / 2
    
    # Draw central play/dubbing wave bars
    bars = [
        (-0.24, 0.28, (0, 242, 254)),    # Cyan
        (-0.12, 0.50, (0, 255, 136)),    # Green
        (0.00,  0.72, (255, 215, 0)),    # Gold (Vietnam star tribute)
        (0.12,  0.50, (255, 75, 75)),    # Red
        (0.24,  0.28, (0, 242, 254))     # Cyan
    ]
    
    bar_width = max(2, int(size * 0.075))
    for x_offset_ratio, h_ratio, color in bars:
        bx = cx + (x_offset_ratio * size)
        bh = h_ratio * size * 0.65
        draw.rounded_rectangle(
            [bx - bar_width/2, cy - bh/2, bx + bar_width/2, cy + bh/2],
            radius=bar_width/2,
            fill=color + (255,)
        )
        
    return img

for s in [16, 48, 128]:
    icon = create_vietdub_icon(s)
    icon.save(f"/home/duongle/vietdub-extension/icons/icon{s}.png")
    print(f"Generated icon{s}.png")
