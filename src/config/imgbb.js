const uploadToImgBB = async (file) => {
  if (!process.env.IMGBB_API_KEY) {
    throw new Error("ImgBB API key is missing");
  }

  const imageBase64 = file.buffer.toString("base64");

  const formData = new URLSearchParams();
  formData.append("image", imageBase64);

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    {
      method: "POST",
      body: formData,
    }
  );

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(
      result.error?.message || "ImgBB upload failed"
    );
  }

  return {
    url: result.data.display_url,
    deleteUrl: result.data.delete_url,
  };
};

module.exports = uploadToImgBB;