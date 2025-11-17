// Main function to initialize the chat interface
function initChat() {
    // Get all required DOM elements
    const chatToggle = document.getElementById('chatToggle');
    const chatBox = document.getElementById('chatBox');
    const userInput = document.getElementById('userInput');
    const chatMessages = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const openIcon = document.querySelector('.open-icon');
    const closeIcon = document.querySelector('.close-icon');

    // Conversation history we send to OpenAI (starts with a system prompt)
    const chatHistory = [
        { 
            role: 'system', 
            content: 'You are a friendly vacation rental assistant. Help users pick fun, whimsical rentals based on their preferences. Keep answers short and cheerful. When you list options (like rentals or steps), format them as clear bullet points each on its own line starting with "- ". Keep paragraphs under two sentences. Use a natural conversational tone.' 
        }
    ];

    // We will store the rentals from rentals.json here once loaded
    let rentalsData = [];

    // ================= QUESTIONNAIRE STATE =================
    // We ask the user a few simple questions BEFORE using the AI.
    // This helps us pick better rentals locally, then we can ask the model to make the answer friendly.
    const questions = [
        'What kind of vibe are you looking for? (spooky, space, funny, cozy, food, magical)',
        'Any location preference? (Nevada, Massachusetts, California, New Mexico, Colorado, Oregon, Texas)',
        'Do you care more about rating or uniqueness?'
    ];
    let questionIndex = 0; // Which question we are on
    const preferences = { vibe: '', location: '', priority: '' }; // Store user answers
    let questionnaireDone = false; // Flag to know when to start normal chatting

    // Load rentals.json so we can recommend properties
    async function loadRentals() {
        try {
            // Fetch the local JSON file that contains all the rental listings
            const res = await fetch('rentals.json');
            if (!res.ok) {
                throw new Error('Could not load rentals data');
            }
            const json = await res.json();
            rentalsData = json.rentals || [];
        } catch (err) {
            console.error('Error loading rentals:', err);
        }
    }
    // Call loadRentals when the chat starts
    loadRentals();

    // Toggle chat visibility and swap icons
    chatToggle.addEventListener('click', function() {
        chatBox.classList.toggle('active');
        openIcon.style.display = chatBox.classList.contains('active') ? 'none' : 'block';
        closeIcon.style.display = chatBox.classList.contains('active') ? 'block' : 'none';
    });

    // Helper: add a user message to the chat window
    function addUserMessage(text) {
        const div = document.createElement('div');
        div.classList.add('message', 'user');
        div.textContent = text;
        chatMessages.appendChild(div);
    }

    // Helper: add a bot message to the chat window
    function addBotMessage(text) {
        const div = document.createElement('div');
        div.classList.add('message', 'bot');
        div.textContent = text;
        chatMessages.appendChild(div);
    }

    // Ask the next question in the list
    function askNextQuestion() {
        if (questionIndex < questions.length) {
            addBotMessage(questions[questionIndex]);
            scrollToLatest();
        } else {
            // All questions answered, compute matches
            questionnaireDone = true;
            showRecommendations();
        }
    }

    // Score rentals based on preferences
    function scoreRental(rental) {
        let score = 0;
        const nameDesc = (rental.name + ' ' + rental.description).toLowerCase();
        // Vibe keyword match adds points
        if (preferences.vibe && nameDesc.includes(preferences.vibe)) {
            score += 5;
        }
        // Location exact match adds points
        if (preferences.location && rental.location.toLowerCase().includes(preferences.location)) {
            score += 4;
        }
        // Priority: if rating, add scaled rating; if uniqueness, boost funky keywords
        if (preferences.priority.includes('rating')) {
            score += rental.avgRating; // add rating directly
        } else if (preferences.priority.includes('unique') || preferences.priority.includes('uniqueness')) {
            const uniqueWords = ['ufo','haunted','meme','upside','marshmallow','unicorn','lava','procrastination','ramen'];
            if (uniqueWords.some(w => nameDesc.includes(w))) {
                score += 3;
            }
        }
        return score;
    }

    // Build and display top recommendations
    function showRecommendations() {
        if (rentalsData.length === 0) {
            addBotMessage('I could not load rentals yet. You can still ask questions!');
            return;
        }
        const scored = rentalsData.map(r => ({ rental: r, score: scoreRental(r) }));
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 3).filter(item => item.score > 0);
        // Build a single bullet list message for readability
        if (top.length === 0) {
            const fallback = rentalsData.slice(0,3).map(r => `- ${r.name} (${r.location}) — Rating ${r.avgRating}`).join('\n');
            addBotMessage('No strong matches from your answers. Here are a few fun choices:\n' + fallback);
        } else {
            const list = top.map(item => {
                const r = item.rental;
                return `- ${r.name} (${r.location}) — Rating ${r.avgRating}`;
            }).join('\n');
            addBotMessage('Here are your top matches:\n' + list);
        }
        // Add a context message so AI knows what we recommended
        const contextLines = top.length > 0 ? top.map(item => {
            const r = item.rental;
            return `${r.name} - ${r.location} - Rating ${r.avgRating}`;
        }) : rentalsData.slice(0,3).map(r => `${r.name} - ${r.location} - Rating ${r.avgRating}`);
        const summary = `User preferences: vibe=${preferences.vibe}, location=${preferences.location}, priority=${preferences.priority}. Recommended rentals:\n${contextLines.join('\n')}`;
        chatHistory.push({ role: 'assistant', content: summary });
        addBotMessage('Feel free to ask more questions or say what matters most!');
        scrollToLatest();
    }

    // Helper: show a temporary typing indicator
    function showTyping() {
        const div = document.createElement('div');
        div.classList.add('message', 'bot', 'typing');
        div.textContent = 'Assistant is thinking...';
        chatMessages.appendChild(div);
        return div; // we return it so we can remove/update later
    }

    // Scroll to newest message
    function scrollToLatest() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Send conversation to OpenAI Chat Completions API
    async function fetchAIReply() {
        try {
            // Make a POST request to OpenAI with the chat history
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}` // apiKey comes from secrets.js
                },
                body: JSON.stringify({
                    model: 'gpt-4o', // Model specified in project instructions
                    messages: chatHistory,
                    temperature: 0.7, // Slight creativity for natural tone
                    max_tokens: 500 // Keep responses concise
                })
            });

            // If the response is not ok, throw an error
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();

            // Safely get the assistant reply
            const aiMessage = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
                ? data.choices[0].message.content.trim()
                : 'Sorry, I could not generate a response.';

            // Add assistant reply to history
            chatHistory.push({ role: 'assistant', content: aiMessage });
            return aiMessage;
        } catch (error) {
            // Log the error (for debugging) and return a friendly message
            console.error('OpenAI API error:', error);
            return 'Oops! Something went wrong. Please try again.';
        }
    }

    // Handle form submission (user sends a message)
    async function handleUserInput(e) {
        e.preventDefault(); // Stop the form from reloading the page
        const message = userInput.value.trim(); // Get the text the user typed
        if (!message) return; // Do nothing if the input is empty

        userInput.value = ''; // Clear the input box
        addUserMessage(message); // Show the user's message in the chat
        scrollToLatest();

        // If questionnaire is not done, treat this message as an answer
        if (!questionnaireDone) {
            if (questionIndex === 0) {
                preferences.vibe = message.toLowerCase();
            } else if (questionIndex === 1) {
                preferences.location = message.toLowerCase();
            } else if (questionIndex === 2) {
                preferences.priority = message.toLowerCase();
            }
            questionIndex++;
            askNextQuestion();
            return; // Do not call the API yet
        }

        // Normal chat after questionnaire
        chatHistory.push({ role: 'user', content: message });
        const typingDiv = showTyping();
        scrollToLatest();

        const reply = await fetchAIReply();
        typingDiv.remove();
        addBotMessage(reply);
        scrollToLatest();
    }

    // Listen for form submission
    chatForm.addEventListener('submit', handleUserInput);

    // Start by greeting and asking the first question
    addBotMessage('Hi! I will ask you a few quick questions to find the perfect whimsical rental.');
    askNextQuestion();
}

// Initialize the chat interface when the page loads
initChat();
