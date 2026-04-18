import os
import re

TARGET_PATHS = [
    '/usr/local/lib/python3.10/site-packages/whisperspeech',
    '/usr/local/lib/python3.10/site-packages/vocos',
    '/usr/local/lib/python3.10/site-packages/vector_quantize_pytorch'
]

def patch_file(path):
    with open(path, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # 1. Force CPU device AND Float32 precision (CPU doesn't support Half/FP16 well)
    # Using .cpu().float() is safer than .to('cpu').float() for some older torch versions, but .to('cpu') is fine.
    # We replace .cuda() with .to("cpu").float() to ensure we convert from FP16 weights if any.
    content = content.replace('.cuda()', '.to("cpu").float()')
    
    # 2. Fix torch.load for CPU (Specific patterns to avoid syntax errors)
    content = content.replace('torch.load(local_filename)', "torch.load(local_filename, map_location='cpu')")
    content = content.replace('torch.load(local_filename_or_obj)', "torch.load(local_filename_or_obj, map_location='cpu')")
    content = content.replace('torch.load(f)', "torch.load(f, map_location='cpu')")
    
    # Fix potential double patching from previous runs (though rebuilding avoids this)
    content = content.replace("map_location='cpu', map_location='cpu'", "map_location='cpu'")
    content = content.replace('.to("cpu").float().to("cpu").float()', '.to("cpu").float()')

    if content != original_content:
        print(f"Patched {path}")
        with open(path, 'w') as f:
            f.write(content)

def main():
    print("Starting CPU Patching (Force Float32)...")
    for target_dir in TARGET_PATHS:
        if not os.path.exists(target_dir):
            print(f"Skipping {target_dir} (not found)")
            continue
            
        for root, _, files in os.walk(target_dir):
            for file in files:
                if file.endswith('.py'):
                    patch_file(os.path.join(root, file))
    print("Patching complete.")

if __name__ == "__main__":
    main()
