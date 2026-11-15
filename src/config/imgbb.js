const uploadToImgBB = async (file) => {
  if (!process.env.IMGBB_API_KEY) {
    throw new Error("ImgBB API key is missing");
  }

  const formData = new FormData();
  formData.append("image", file.buffer.toString("base64"));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`,
    {
      method: "POST",
      body: formData,
    }
  );

  const responseBody = await response.text();
  let result;

  try {
    result = JSON.parse(responseBody);
  } catch {
    throw new Error(
      `ImgBB returned an invalid response (HTTP ${response.status})`
    );
  }

  if (!response.ok || !result.success) {
    throw new Error(
      result.error?.message || `ImgBB upload failed (HTTP ${response.status})`
    );
  }

  if (!result.data?.display_url || !result.data?.id) {
    throw new Error("ImgBB returned an incomplete upload result");
  }

  return {
    url: result.data.display_url,
    imageId: result.data.id,
    deleteUrl: result.data.delete_url,
  };
};

module.exports = uploadToImgBB;