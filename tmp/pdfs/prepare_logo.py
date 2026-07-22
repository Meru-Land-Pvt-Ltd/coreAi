from pathlib import Path

from PIL import Image


SOURCE = Path("apps/frontend/public/triven.ai word logo transparent bg.PNG")
DESTINATION = Path("tmp/pdfs/triven-mark-orange.png")
TRIVEN_ORANGE = (245, 158, 11)


image = Image.open(SOURCE).convert("RGBA")
alpha = image.getchannel("A")
bounds = alpha.getbbox()

if bounds is None:
    raise RuntimeError("The Triven logo has no visible pixels")

alpha = alpha.crop(bounds)
solid = Image.new("RGBA", alpha.size, (*TRIVEN_ORANGE, 0))
solid.putalpha(alpha)
solid.save(DESTINATION)

print(f"saved={DESTINATION} size={solid.size}")
