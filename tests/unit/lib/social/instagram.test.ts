import { describe, expect, it } from "vitest";
import { getMockInstagramPosts } from "@/lib/social/instagram";

describe("Instagram Service", () => {
  describe("getMockInstagramPosts", () => {
    it("returns an array of posts", () => {
      const posts = getMockInstagramPosts();
      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBeGreaterThan(0);
    });

    it("returns the default limit of 9 posts", () => {
      const posts = getMockInstagramPosts();
      expect(posts.length).toBe(9);
    });

    it("respects a custom limit", () => {
      const posts = getMockInstagramPosts(3);
      expect(posts.length).toBe(3);
    });

    it("returns posts with the correct shape", () => {
      const posts = getMockInstagramPosts(1);
      expect(posts).toHaveLength(1);
      const post = posts[0]!;

      expect(post).toHaveProperty("id");
      expect(post).toHaveProperty("postId");
      expect(post).toHaveProperty("caption");
      expect(post).toHaveProperty("mediaUrl");
      expect(post).toHaveProperty("permalink");
      expect(post).toHaveProperty("mediaType");
      expect(post).toHaveProperty("timestamp");

      expect(typeof post.id).toBe("number");
      expect(typeof post.postId).toBe("string");
      expect(typeof post.mediaUrl).toBe("string");
      expect(typeof post.permalink).toBe("string");
    });

    it("has valid mediaType values", () => {
      const posts = getMockInstagramPosts(9);
      const validTypes = ["image", "video", "carousel"];

      for (const post of posts) {
        expect(validTypes).toContain(post.mediaType);
      }
    });

    it("returns a valid URL for mediaUrl", () => {
      const posts = getMockInstagramPosts(1);
      expect(posts).toHaveLength(1);
      const post = posts[0]!;

      expect(() => new URL(post.mediaUrl)).not.toThrow();
    });

    it("returns a valid URL for permalink", () => {
      const posts = getMockInstagramPosts(1);
      expect(posts).toHaveLength(1);
      const post = posts[0]!;

      expect(() => new URL(post.permalink)).not.toThrow();
    });

    it("returns ISO 8601 timestamps", () => {
      const posts = getMockInstagramPosts(1);
      expect(posts).toHaveLength(1);
      const post = posts[0]!;

      const timestamp = new Date(post.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it("returns an empty array when limit is 0", () => {
      const posts = getMockInstagramPosts(0);
      expect(posts).toHaveLength(0);
    });

    it("does not return more posts than available in mock data", () => {
      const posts = getMockInstagramPosts(100);
      expect(posts.length).toBeLessThanOrEqual(9);
    });
  });
});
