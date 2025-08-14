import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

def download_images(url, folder="downloaded_images"):
    # Create folder if it doesn't exist
    if not os.path.exists(folder):
        os.makedirs(folder)

    # Get the HTML content of the page
    response = requests.get(url)
    if response.status_code != 200:
        print(f"Failed to retrieve page: {response.status_code}")
        return

    # Parse the HTML
    soup = BeautifulSoup(response.text, "html.parser")

    # Find all <img> tags
    img_tags = soup.find_all("img")
    print(f"Found {len(img_tags)} images.")

    # Loop through each image
    for i, img in enumerate(img_tags, start=1):
        img_url = img.get("src")
        if not img_url:
            continue

        # Join relative URLs with the base URL
        img_url = urljoin(url, img_url)

        # Get the image filename
        img_name = os.path.basename(urlparse(img_url).path)
        if not img_name:  # If image name is empty, use a default one
            img_name = f"image_{i}.jpg"

        # Download the image
        try:
            img_data = requests.get(img_url).content
            img_path = os.path.join(folder, img_name)
            with open(img_path, "wb") as f:
                f.write(img_data)
            print(f"Downloaded: {img_url}")
        except Exception as e:
            print(f"Failed to download {img_url}: {e}")

# Example usage
website_url = "https://kannancrackers.in/"
download_images(website_url)
