// Recipe Box's opencode plugin, written into the app's opencode config folder
// (see opencode.rs). It gives the job's agent the job's tools and nothing else:
// each call goes to the app, which answers it.
export default {
  id: "recipebox",
  async setup(ctx) {
    const tools = JSON.parse(process.env.RECIPEBOX_TOOLS ?? "[]")
    if (tools.length === 0) return
    await ctx.tool.transform((editor) => {
      // opencode offers its skill tool even when no skills exist, and models try it.
      editor.remove("skill")
      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.inputSchema,
          options: { codemode: false },
          async execute(input) {
            const response = await fetch(process.env.RECIPEBOX_TOOL_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RECIPEBOX_JOB}` },
              body: JSON.stringify({ name: tool.name, arguments: input }),
            })
            if (!response.ok) throw new Error(`Recipe Box couldn't run ${tool.name} (${response.status})`)
            const { text } = await response.json()
            return { content: text }
          },
        })
      }
    })
  },
}
